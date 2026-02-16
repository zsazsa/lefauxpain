use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use webrtc::media::Sample;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;

const FRAME_DURATION: Duration = Duration::from_millis(33); // ~30 FPS
const BITRATE_KBPS: u32 = 5000;
const PREVIEW_INTERVAL: Duration = Duration::from_millis(100); // ~10 FPS preview
const PREVIEW_MAX_WIDTH: u32 = 360;

struct FrameData {
    data: Vec<u8>,
    width: u32,
    height: u32,
    is_bgra: bool,
}

pub struct PortalResult {
    pub node_id: u32,
    pub width: u32,
    pub height: u32,
    pub fd: std::os::fd::OwnedFd,
}

pub struct ScreenCapture {
    task_handle: Option<tokio::task::JoinHandle<()>>,
    stop_flag: Arc<AtomicBool>,
}

impl ScreenCapture {
    pub fn new() -> Self {
        Self {
            task_handle: None,
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(
        &mut self,
        track: Arc<TrackLocalStaticSample>,
        app: AppHandle,
        portal: PortalResult,
    ) {
        // Create a fresh stop flag for this session — old threads keep their own flag (true)
        let stop = Arc::new(AtomicBool::new(false));
        self.stop_flag = stop.clone();
        let handle = tokio::spawn(async move {
            if let Err(e) = run_capture(track, app, stop, portal).await {
                eprintln!("[screen] Capture error: {}", e);
            }
        });
        self.task_handle = Some(handle);
    }

    pub fn stop(&mut self) {
        // Signal this session's loops to stop
        self.stop_flag.store(true, Ordering::Release);
        if let Some(handle) = self.task_handle.take() {
            handle.abort();
        }
        eprintln!("[screen] Capture stop signaled");
    }
}

/// Use xdg-desktop-portal to show a screen/window picker and start a PipeWire screencast.
/// Runs synchronously from the caller's perspective (awaitable) so errors propagate immediately.
pub async fn portal_start_screencast(
) -> Result<PortalResult, Box<dyn std::error::Error + Send + Sync>> {
    use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType};
    use ashpd::desktop::PersistMode;

    let proxy = Screencast::new().await?;
    let session = proxy.create_session().await?;

    proxy
        .select_sources(
            &session,
            CursorMode::Embedded,
            SourceType::Monitor | SourceType::Window,
            false,
            None,
            PersistMode::DoNot,
        )
        .await?
        .response()?;

    let response = proxy
        .start(&session, &ashpd::WindowIdentifier::default())
        .await?
        .response()?;
    let stream = response.streams().first().ok_or("no streams returned")?;
    let node_id = stream.pipe_wire_node_id();
    let (w, h) = stream.size().unwrap_or((1920, 1080));

    let fd = proxy.open_pipe_wire_remote(&session).await?;

    eprintln!(
        "[screen] Portal screencast: node={}, {}x{}",
        node_id,
        w,
        h
    );

    Ok(PortalResult {
        node_id,
        width: w as u32,
        height: h as u32,
        fd,
    })
}

async fn run_capture(
    track: Arc<TrackLocalStaticSample>,
    app: AppHandle,
    stop: Arc<AtomicBool>,
    portal: PortalResult,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Spawn PipeWire frame reader on a dedicated thread
    let (frame_tx, mut frame_rx) = tokio::sync::mpsc::channel::<FrameData>(4);

    let pw_stop = stop.clone();
    std::thread::spawn(move || {
        if let Err(e) = pipewire_capture_loop(portal.fd, portal.node_id, portal.width, portal.height, frame_tx, pw_stop) {
            eprintln!("[screen] PipeWire capture error: {:?}", e);
        }
        eprintln!("[screen] PipeWire thread exited");
    });

    // Step 3: H.264 encode loop on spawn_blocking (Encoder is not Send)
    let track_clone = Arc::clone(&track);
    let enc_stop = stop.clone();
    tokio::task::spawn_blocking(move || {
        use openh264::encoder::{Encoder, EncoderConfig};
        use openh264::formats::YUVBuffer;

        let rt = tokio::runtime::Handle::current();

        // Wait for first frame to get actual dimensions
        let first_frame = match rt.block_on(frame_rx.recv()) {
            Some(f) => f,
            None => return,
        };

        let w = (first_frame.width as usize) & !1;
        let h = (first_frame.height as usize) & !1;

        eprintln!("[screen] First frame: {}x{}, bgra={}, data_len={}",
            first_frame.width, first_frame.height, first_frame.is_bgra, first_frame.data.len());

        let config = EncoderConfig::new()
            .set_bitrate_bps(BITRATE_KBPS * 1000)
            .usage_type(openh264::encoder::UsageType::ScreenContentRealTime)
            .max_frame_rate(30.0)
            .enable_skip_frame(false)
            .rate_control_mode(openh264::encoder::RateControlMode::Bitrate);
        let mut encoder = match Encoder::with_api_config(openh264::OpenH264API::from_source(), config) {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[screen] H.264 encoder init failed: {:?}", e);
                return;
            }
        };

        eprintln!("[screen] Encode loop started ({}x{})", w, h);

        let mut last_preview = Instant::now() - PREVIEW_INTERVAL;

        // Process the first frame
        let mut pending = Some(first_frame);

        loop {
            let frame = if let Some(f) = pending.take() {
                f
            } else {
                match rt.block_on(frame_rx.recv()) {
                    Some(f) => f,
                    None => break, // channel closed
                }
            };

            if enc_stop.load(Ordering::Relaxed) {
                eprintln!("[screen] Encode loop: stop flag set, exiting");
                break;
            }

            let fw = (frame.width as usize) & !1;
            let fh = (frame.height as usize) & !1;

            // Skip frames whose dimensions don't match the encoder (crop changed,
            // window resized, etc.) — avoids feeding wrong-sized I420 data to H.264.
            if fw != w || fh != h {
                continue;
            }

            // Emit JPEG preview thumbnail periodically
            if last_preview.elapsed() >= PREVIEW_INTERVAL {
                last_preview = Instant::now();
                if let Some(jpeg_b64) = make_preview_jpeg(&frame.data, fw, fh, frame.is_bgra) {
                    let _ = app.emit("screen:preview", &jpeg_b64);
                }
            }

            let i420 = if frame.is_bgra {
                bgra_to_i420(&frame.data, fw, fh)
            } else {
                rgba_to_i420(&frame.data, fw, fh)
            };

            let yuv = YUVBuffer::from_vec(i420, fw, fh);
            match encoder.encode(&yuv) {
                Ok(bitstream) => {
                    let data = bitstream.to_vec();
                    if !data.is_empty() {
                        let sample = Sample {
                            data: bytes::Bytes::from(data),
                            duration: FRAME_DURATION,
                            ..Default::default()
                        };
                        let track = Arc::clone(&track_clone);
                        rt.block_on(async {
                            if let Err(e) = track.write_sample(&sample).await {
                                log::warn!("[screen] write_sample: {}", e);
                            }
                        });
                    }
                }
                Err(e) => {
                    eprintln!("[screen] H.264 encode error: {:?}", e);
                }
            }
        }

        eprintln!("[screen] Encode loop exited");
    })
    .await?;

    Ok(())
}

/// PipeWire main loop: connect to screencast stream, read frames, send via channel.
fn pipewire_capture_loop(
    pw_fd: std::os::fd::OwnedFd,
    node_id: u32,
    width: u32,
    height: u32,
    frame_tx: tokio::sync::mpsc::Sender<FrameData>,
    stop: Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error>> {
    pipewire::init();

    let mainloop = pipewire::main_loop::MainLoop::new(None)
        .map_err(|_| "failed to create PipeWire main loop")?;
    let context = pipewire::context::Context::new(&mainloop)
        .map_err(|_| "failed to create PipeWire context")?;

    let core = context
        .connect_fd(pw_fd, None)
        .map_err(|_| "failed to connect PipeWire fd")?;

    let stream = pipewire::stream::Stream::new(
        &core,
        "screen-capture",
        pipewire::properties::properties! {
            *pipewire::keys::MEDIA_TYPE => "Video",
            *pipewire::keys::MEDIA_CATEGORY => "Capture",
            *pipewire::keys::MEDIA_ROLE => "Screen",
        },
    )
    .map_err(|_| "failed to create PipeWire stream")?;

    // Raw pointer to mainloop for quitting from within callbacks.
    // Safety: mainloop lives on this thread's stack and outlives all callbacks
    // (callbacks only run during mainloop.run() which blocks in this function).
    let mainloop_ptr = &mainloop as *const pipewire::main_loop::MainLoop;

    /// Wrapper to allow raw pointer in CaptureState.
    /// Safety: only accessed from the PipeWire thread (same thread that owns mainloop).
    struct MainLoopQuit(*const pipewire::main_loop::MainLoop);
    unsafe impl Send for MainLoopQuit {}
    unsafe impl Sync for MainLoopQuit {}

    struct CaptureState {
        tx: tokio::sync::mpsc::Sender<FrameData>,
        /// Actual content width in pixels (from portal, not from stride).
        content_w: u32,
        /// Actual content height in pixels.
        content_h: u32,
        is_bgra: bool,
        stop: Arc<AtomicBool>,
        stopped: bool,
        quit: MainLoopQuit,
        cached_crop: CropResult,
        crop_counter: u32,
        logged_first: bool,
    }

    let state = CaptureState {
        tx: frame_tx,
        content_w: width,
        content_h: height,
        is_bgra: true,
        stop,
        stopped: false,
        quit: MainLoopQuit(mainloop_ptr),
        cached_crop: CropResult::FullFrame,
        crop_counter: 0,
        logged_first: false,
    };

    let _listener = stream
        .add_local_listener_with_user_data(state)
        .param_changed(|_stream, state, id, param| {
            use libspa::param::ParamType;
            use libspa::param::format::FormatProperties;
            use libspa::pod::deserialize::PodDeserializer;
            use libspa::pod::Value;

            // SPA_PARAM_Format = the finalized negotiated format
            if id != ParamType::Format.as_raw() {
                return;
            }

            // Parse the pod to extract the actual VideoSize (width x height)
            if let Some(pod) = param {
                if let Ok((_, Value::Object(obj))) =
                    PodDeserializer::deserialize_from::<Value>(pod.as_bytes())
                {
                    for prop in &obj.properties {
                        if prop.key == FormatProperties::VideoSize.as_raw() {
                            if let Value::Rectangle(rect) = &prop.value {
                                eprintln!(
                                    "[screen] Negotiated video size: {}x{} (was {}x{})",
                                    rect.width, rect.height,
                                    state.content_w, state.content_h
                                );
                                state.content_w = rect.width;
                                state.content_h = rect.height;
                            }
                        }
                    }
                }
            }

            eprintln!(
                "[screen] PipeWire format finalized: {}x{}",
                state.content_w,
                state.content_h
            );
        })
        .process(|stream, state| {
            if state.stopped {
                return;
            }

            // Check stop flag — quit PipeWire main loop so the thread can exit cleanly
            if state.stop.load(Ordering::Relaxed) {
                state.stopped = true;
                unsafe { (&*state.quit.0).quit(); }
                return;
            }

            let Some(mut buffer) = stream.dequeue_buffer() else {
                return;
            };
            let datas = buffer.datas_mut();
            if datas.is_empty() {
                return;
            }

            let d = &mut datas[0];
            let chunk = d.chunk();
            let stride = chunk.stride() as usize;
            let size = chunk.size() as usize;
            let offset = chunk.offset() as usize;

            if size == 0 || stride == 0 {
                return;
            }

            let Some(raw) = d.data() else { return };
            if raw.len() < offset + size {
                return;
            }
            let raw = &raw[offset..offset + size];

            // Content dimensions come from portal; stride may be wider due to alignment.
            let content_w = state.content_w as usize;
            let content_h = state.content_h as usize;
            let buf_h = if stride > 0 { size / stride } else { 0 };

            // Use the smaller of portal height and buffer rows
            let h = content_h.min(buf_h);
            let w = content_w;
            if w == 0 || h == 0 || stride < w * 4 {
                return;
            }

            if !state.logged_first {
                state.logged_first = true;
                eprintln!(
                    "[screen] First buffer: content={}x{}, stride={}, buf_rows={}, size={}",
                    w, h, stride, buf_h, size
                );
            }

            // Detect crop via alpha channel (GNOME window capture blacks out
            // non-window areas with alpha=0). Only re-scan periodically.
            state.crop_counter += 1;
            if state.crop_counter % 30 == 1 {
                state.cached_crop = detect_alpha_crop(raw, w, h, stride);
            }

            let (frame, fw, fh) = match state.cached_crop {
                CropResult::Empty => {
                    // Window not visible (minimized / other workspace) — skip frame
                    return;
                }
                CropResult::Cropped(cx, cy, cw, ch) => {
                    // Round to even dimensions NOW so the extracted data matches
                    // what the VP8 encoder expects (avoids row-width mismatch → warp).
                    let cw = cw & !1;
                    let ch = ch & !1;
                    if cw == 0 || ch == 0 {
                        return;
                    }
                    let mut f = vec![0u8; cw * ch * 4];
                    for row in 0..ch {
                        let src_off = (cy + row) * stride + cx * 4;
                        let dst_off = row * cw * 4;
                        if src_off + cw * 4 <= raw.len() {
                            f[dst_off..dst_off + cw * 4]
                                .copy_from_slice(&raw[src_off..src_off + cw * 4]);
                        }
                    }
                    (f, cw as u32, ch as u32)
                }
                CropResult::FullFrame => {
                    // Round to even dimensions for VP8 encoder
                    let ew = w & !1;
                    let eh = h & !1;
                    if ew == 0 || eh == 0 {
                        return;
                    }
                    let row_bytes = ew * 4;
                    let mut f = vec![0u8; ew * eh * 4];
                    for row in 0..eh {
                        let src_start = row * stride;
                        let dst_start = row * row_bytes;
                        if src_start + row_bytes <= raw.len() {
                            f[dst_start..dst_start + row_bytes]
                                .copy_from_slice(&raw[src_start..src_start + row_bytes]);
                        }
                    }
                    (f, ew as u32, eh as u32)
                }
            };

            match state.tx.try_send(FrameData {
                data: frame,
                width: fw,
                height: fh,
                is_bgra: state.is_bgra,
            }) {
                Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                    // Receiver dropped — quit the main loop
                    state.stopped = true;
                    unsafe { (&*state.quit.0).quit(); }
                }
                _ => {} // Ok or Full — drop excess frames
            }
        })
        .register()
        .map_err(|_| "failed to register PipeWire listener")?;

    // Build SPA format params: accept BGRA/RGBA/BGRx/RGBx raw video
    let params_bytes = {
        use libspa::pod::{Object, Property, PropertyFlags, Value, ChoiceValue};
        use libspa::pod::serialize::PodSerializer;
        use libspa::utils::{Id, SpaTypes, Choice, ChoiceFlags, ChoiceEnum};
        use libspa::param::ParamType;
        use libspa::param::format::{FormatProperties, MediaType, MediaSubtype};
        use libspa::param::video::VideoFormat;

        let obj = Object {
            type_: SpaTypes::ObjectParamFormat.as_raw(),
            id: ParamType::EnumFormat.as_raw(),
            properties: vec![
                Property {
                    key: FormatProperties::MediaType.as_raw(),
                    flags: PropertyFlags::empty(),
                    value: Value::Id(Id(MediaType::Video.as_raw())),
                },
                Property {
                    key: FormatProperties::MediaSubtype.as_raw(),
                    flags: PropertyFlags::empty(),
                    value: Value::Id(Id(MediaSubtype::Raw.as_raw())),
                },
                Property {
                    key: FormatProperties::VideoFormat.as_raw(),
                    flags: PropertyFlags::empty(),
                    value: Value::Choice(ChoiceValue::Id(
                        Choice(
                            ChoiceFlags::empty(),
                            ChoiceEnum::Enum {
                                default: Id(VideoFormat::BGRA.as_raw()),
                                alternatives: vec![
                                    Id(VideoFormat::RGBA.as_raw()),
                                    Id(VideoFormat::BGRx.as_raw()),
                                    Id(VideoFormat::RGBx.as_raw()),
                                ],
                            },
                        )
                    )),
                },
                // No VideoSize constraint — let PipeWire deliver at the source's native size
            ],
        };

        PodSerializer::serialize(
            std::io::Cursor::new(Vec::new()),
            &Value::Object(obj),
        )
        .map_err(|_| "failed to serialize format params")?
        .0
        .into_inner()
    };

    let pod = libspa::pod::Pod::from_bytes(&params_bytes)
        .ok_or("failed to create Pod from serialized bytes")?;

    stream
        .connect(
            pipewire::spa::utils::Direction::Input,
            Some(node_id),
            pipewire::stream::StreamFlags::AUTOCONNECT
                | pipewire::stream::StreamFlags::MAP_BUFFERS,
            &mut [pod],
        )
        .map_err(|_| "failed to connect PipeWire stream")?;

    eprintln!("[screen] PipeWire main loop starting (node_id={})", node_id);
    mainloop.run();
    eprintln!("[screen] PipeWire main loop ended");

    Ok(())
}

/// Result of alpha-based crop detection.
#[derive(Clone, Copy)]
enum CropResult {
    /// All corners opaque — full monitor capture, send entire frame.
    FullFrame,
    /// Window capture — crop to this (x, y, w, h) region.
    Cropped(usize, usize, usize, usize),
    /// Fully transparent — window is minimized / off-screen, skip frame.
    Empty,
}

/// Detect bounding box of opaque pixels (alpha > 0) in a BGRA buffer with given stride.
fn detect_alpha_crop(data: &[u8], w: usize, h: usize, stride: usize) -> CropResult {
    if w == 0 || h == 0 {
        return CropResult::Empty;
    }

    // Quick check: if all four corners are opaque, this is likely a full monitor
    // capture and no cropping is needed.
    let alpha_at = |x: usize, y: usize| -> u8 {
        let off = y * stride + x * 4 + 3;
        if off < data.len() { data[off] } else { 0 }
    };

    if alpha_at(0, 0) == 255
        && alpha_at(w - 1, 0) == 255
        && alpha_at(0, h - 1) == 255
        && alpha_at(w - 1, h - 1) == 255
    {
        return CropResult::FullFrame;
    }

    // Full scan to find bounding box of non-transparent pixels
    let mut top = h;
    let mut bottom = 0;
    let mut left = w;
    let mut right = 0;

    for y in 0..h {
        for x in 0..w {
            if alpha_at(x, y) > 0 {
                if y < top { top = y; }
                bottom = y;
                if x < left { left = x; }
                if x > right { right = x; }
            }
        }
    }

    if top > bottom || left > right {
        return CropResult::Empty; // fully transparent — window not visible
    }

    let cw = right - left + 1;
    let ch = bottom - top + 1;

    // If the crop covers the whole frame, no cropping needed
    if cw >= w && ch >= h {
        return CropResult::FullFrame;
    }

    CropResult::Cropped(left, top, cw, ch)
}

/// Downscale frame and encode as JPEG, returning base64 data URL.
fn make_preview_jpeg(data: &[u8], w: usize, h: usize, is_bgra: bool) -> Option<String> {
    use image::codecs::jpeg::JpegEncoder;
    use std::io::Cursor;

    // Downscale dimensions
    let scale = if w as u32 > PREVIEW_MAX_WIDTH {
        PREVIEW_MAX_WIDTH as f32 / w as f32
    } else {
        1.0
    };
    let tw = ((w as f32 * scale) as usize) & !1;
    let th = ((h as f32 * scale) as usize) & !1;
    if tw == 0 || th == 0 {
        return None;
    }

    // Nearest-neighbor downscale + BGRA→RGB / RGBA→RGB
    let mut rgb = vec![0u8; tw * th * 3];
    for row in 0..th {
        let src_row = row * h / th;
        for col in 0..tw {
            let src_col = col * w / tw;
            let src_px = (src_row * w + src_col) * 4;
            let dst_px = (row * tw + col) * 3;
            if is_bgra {
                rgb[dst_px] = data[src_px + 2];     // R
                rgb[dst_px + 1] = data[src_px + 1]; // G
                rgb[dst_px + 2] = data[src_px];      // B
            } else {
                rgb[dst_px] = data[src_px];           // R
                rgb[dst_px + 1] = data[src_px + 1];   // G
                rgb[dst_px + 2] = data[src_px + 2];   // B
            }
        }
    }

    let mut buf = Cursor::new(Vec::new());
    let encoder = JpegEncoder::new_with_quality(&mut buf, 40);
    if image::ImageEncoder::write_image(
        encoder,
        &rgb,
        tw as u32,
        th as u32,
        image::ExtendedColorType::Rgb8,
    ).is_err() {
        return None;
    }

    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Some(format!("data:image/jpeg;base64,{}", b64))
}

/// Convert BGRA pixels to I420 (YUV420p) using fixed-point BT.601 coefficients.
/// Integer math avoids float ops — ~3-5x faster than the float version.
fn bgra_to_i420(bgra: &[u8], width: usize, height: usize) -> Vec<u8> {
    let y_size = width * height;
    let uv_width = width / 2;
    let uv_height = height / 2;
    let uv_size = uv_width * uv_height;

    let mut yuv = vec![0u8; y_size + uv_size * 2];
    let (y_plane, uv_planes) = yuv.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_size);

    // Y plane: one sample per pixel
    for row in 0..height {
        let row_off = row * width;
        for col in 0..width {
            let px = (row_off + col) * 4;
            let b = bgra[px] as i32;
            let g = bgra[px + 1] as i32;
            let r = bgra[px + 2] as i32;
            // Y = 16 + (66*R + 129*G + 25*B + 128) >> 8
            y_plane[row_off + col] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8;
        }
    }

    // U/V planes: 2x2 subsampled
    for row in 0..uv_height {
        let src_row = row * 2;
        let uv_off = row * uv_width;
        for col in 0..uv_width {
            let src_col = col * 2;
            let mut r_sum = 0i32;
            let mut g_sum = 0i32;
            let mut b_sum = 0i32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let px = ((src_row + dy) * width + (src_col + dx)) * 4;
                    b_sum += bgra[px] as i32;
                    g_sum += bgra[px + 1] as i32;
                    r_sum += bgra[px + 2] as i32;
                }
            }
            // Average the 2x2 block (>> 2)
            let r = r_sum >> 2;
            let g = g_sum >> 2;
            let b = b_sum >> 2;
            // U = 128 + (-38*R - 74*G + 112*B + 128) >> 8
            u_plane[uv_off + col] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            // V = 128 + (112*R - 94*G - 18*B + 128) >> 8
            v_plane[uv_off + col] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }

    yuv
}

/// Convert RGBA pixels to I420 (YUV420p) using fixed-point BT.601 coefficients.
fn rgba_to_i420(rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    let y_size = width * height;
    let uv_width = width / 2;
    let uv_height = height / 2;
    let uv_size = uv_width * uv_height;

    let mut yuv = vec![0u8; y_size + uv_size * 2];
    let (y_plane, uv_planes) = yuv.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_size);

    for row in 0..height {
        let row_off = row * width;
        for col in 0..width {
            let px = (row_off + col) * 4;
            let r = rgba[px] as i32;
            let g = rgba[px + 1] as i32;
            let b = rgba[px + 2] as i32;
            y_plane[row_off + col] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8;
        }
    }

    for row in 0..uv_height {
        let src_row = row * 2;
        let uv_off = row * uv_width;
        for col in 0..uv_width {
            let src_col = col * 2;
            let mut r_sum = 0i32;
            let mut g_sum = 0i32;
            let mut b_sum = 0i32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let px = ((src_row + dy) * width + (src_col + dx)) * 4;
                    r_sum += rgba[px] as i32;
                    g_sum += rgba[px + 1] as i32;
                    b_sum += rgba[px + 2] as i32;
                }
            }
            let r = r_sum >> 2;
            let g = g_sum >> 2;
            let b = b_sum >> 2;
            u_plane[uv_off + col] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            v_plane[uv_off + col] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }

    yuv
}
