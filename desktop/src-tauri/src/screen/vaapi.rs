use std::rc::Rc;

use cros_codecs::backend::vaapi::encoder::VaapiBackend;
use cros_codecs::codec::h264::parser::{Level, Profile};
use cros_codecs::encoder::stateless::h264::StatelessEncoder;
use cros_codecs::encoder::h264::EncoderConfig;
use cros_codecs::encoder::{
    FrameMetadata, PredictionStructure, RateControl, Tunings, VideoEncoder,
};
use cros_codecs::{BlockingMode, Fourcc, FrameLayout, PlaneLayout, Resolution};
use cros_codecs::libva::constants::VA_RT_FORMAT_YUV420;
use cros_codecs::libva::{Display, Image, Surface, UsageHint, VAEntrypoint, VAProfile};

use super::encoder::{FrameData, ScreenEncoder};

type H264Encoder = StatelessEncoder<Surface<()>, VaapiBackend<(), Surface<()>>>;

pub struct VaapiEncoder {
    display: Rc<Display>,
    encoder: H264Encoder,
    width: u32,
    height: u32,
    frame_count: u64,
    force_next_idr: bool,
    nv12_buf: Vec<u8>,
    frame_layout: FrameLayout,
    nv12_image_fmt: cros_codecs::libva::VAImageFormat,
}

impl VaapiEncoder {
    pub fn try_new(width: u32, height: u32, bitrate_kbps: u32) -> Option<Self> {
        let display = Display::open().or_else(|| {
            eprintln!("[screen] VAAPI: no display found");
            None
        })?;

        // Check for H.264 encoding support
        let entrypoints = display
            .query_config_entrypoints(VAProfile::VAProfileH264Main)
            .map_err(|e| {
                eprintln!("[screen] VAAPI: failed to query entrypoints: {:?}", e);
                e
            })
            .ok()?;

        let low_power =
            entrypoints.contains(&VAEntrypoint::VAEntrypointEncSliceLP);
        let has_enc = low_power
            || entrypoints.contains(&VAEntrypoint::VAEntrypointEncSlice);

        if !has_enc {
            eprintln!("[screen] VAAPI: no H.264 encode entrypoint");
            return None;
        }

        let config = EncoderConfig {
            profile: Profile::Main,
            resolution: Resolution { width, height },
            level: Level::L4,
            pred_structure: PredictionStructure::LowDelay { limit: 2048 },
            initial_tunings: Tunings {
                rate_control: RateControl::ConstantBitrate(bitrate_kbps as u64 * 1000),
                framerate: 60,
                min_quality: 1,
                max_quality: 51,
            },
        };

        let fourcc = Fourcc::from(b"NV12");
        let coded_size = Resolution { width, height };

        let encoder = H264Encoder::new_vaapi(
            Rc::clone(&display),
            config,
            fourcc,
            coded_size,
            low_power,
            BlockingMode::Blocking,
        )
        .map_err(|e| {
            eprintln!("[screen] VAAPI: encoder creation failed: {:?}", e);
            e
        })
        .ok()?;

        // Find NV12 image format for surface upload
        let image_fmts = display
            .query_image_formats()
            .map_err(|e| {
                eprintln!("[screen] VAAPI: failed to query image formats: {:?}", e);
                e
            })
            .ok()?;

        let nv12_fourcc = u32::from_ne_bytes(*b"NV12");
        let nv12_image_fmt = image_fmts
            .into_iter()
            .find(|f| f.fourcc == nv12_fourcc)
            .or_else(|| {
                eprintln!("[screen] VAAPI: no NV12 image format available");
                None
            })?;

        let nv12_size = (width * height * 3 / 2) as usize;
        let frame_layout = FrameLayout {
            format: (fourcc, 0),
            size: Resolution { width, height },
            planes: vec![
                PlaneLayout {
                    buffer_index: 0,
                    offset: 0,
                    stride: width as usize,
                },
                PlaneLayout {
                    buffer_index: 0,
                    offset: (width * height) as usize,
                    stride: width as usize,
                },
            ],
        };

        eprintln!(
            "[screen] VAAPI encoder initialized ({}x{}, {}kbps, low_power={})",
            width, height, bitrate_kbps, low_power
        );

        Some(Self {
            display,
            encoder,
            width,
            height,
            frame_count: 0,
            force_next_idr: true, // first frame is always IDR
            nv12_buf: vec![0u8; nv12_size],
            frame_layout,
            nv12_image_fmt,
        })
    }

    fn upload_nv12_to_surface(
        &self,
        surface: &Surface<()>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut image = Image::create_from(
            surface,
            self.nv12_image_fmt,
            (self.width, self.height),
            (self.width, self.height),
        )?;

        let va_image = *image.image();
        let dest = image.as_mut();

        let w = self.width as usize;
        let h = self.height as usize;

        // Y plane: copy row-by-row respecting VA pitch
        let y_offset = va_image.offsets[0] as usize;
        let y_pitch = va_image.pitches[0] as usize;
        for row in 0..h {
            let src_start = row * w;
            let dst_start = y_offset + row * y_pitch;
            dest[dst_start..dst_start + w]
                .copy_from_slice(&self.nv12_buf[src_start..src_start + w]);
        }

        // UV plane: interleaved, half height, width bytes per row
        let uv_offset = va_image.offsets[1] as usize;
        let uv_pitch = va_image.pitches[1] as usize;
        let uv_src_start = w * h;
        for row in 0..(h / 2) {
            let src_start = uv_src_start + row * w;
            let dst_start = uv_offset + row * uv_pitch;
            dest[dst_start..dst_start + w]
                .copy_from_slice(&self.nv12_buf[src_start..src_start + w]);
        }

        // Drop image triggers vaPutImage writeback
        drop(image);
        Ok(())
    }
}

impl ScreenEncoder for VaapiEncoder {
    fn encode(&mut self, frame: &FrameData) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let w = frame.width as usize;
        let h = frame.height as usize;

        // Convert BGRA/RGBA to NV12 into reusable buffer
        if frame.is_bgra {
            bgra_to_nv12(&frame.data, &mut self.nv12_buf, w, h);
        } else {
            rgba_to_nv12(&frame.data, &mut self.nv12_buf, w, h);
        }

        // Create a fresh VA surface
        let surfaces = self.display.create_surfaces(
            VA_RT_FORMAT_YUV420,
            Some(u32::from_ne_bytes(*b"NV12")),
            self.width,
            self.height,
            Some(UsageHint::USAGE_HINT_ENCODER),
            vec![()],
        )?;
        let surface = surfaces
            .into_iter()
            .next()
            .ok_or("failed to create VA surface")?;

        // Upload NV12 data to the surface
        self.upload_nv12_to_surface(&surface)?;

        // Build frame metadata
        let force_kf = self.force_next_idr;
        self.force_next_idr = false;

        let meta = FrameMetadata {
            timestamp: self.frame_count,
            layout: self.frame_layout.clone(),
            force_keyframe: force_kf,
        };
        self.frame_count += 1;

        // Submit frame to encoder
        self.encoder.encode(meta, surface)?;

        // Poll for encoded output
        let mut output = Vec::new();
        while let Some(coded) = self.encoder.poll()? {
            output.extend_from_slice(&coded.bitstream);
        }

        Ok(output)
    }

    fn force_keyframe(&mut self) {
        self.force_next_idr = true;
    }
}

/// Convert BGRA pixels to NV12 using fixed-point BT.601 coefficients.
/// NV12 layout: Y plane (w*h bytes) followed by interleaved UV plane (w*h/2 bytes).
fn bgra_to_nv12(bgra: &[u8], nv12: &mut [u8], width: usize, height: usize) {
    let y_size = width * height;
    let (y_plane, uv_plane) = nv12.split_at_mut(y_size);

    // Y plane: one sample per pixel
    for row in 0..height {
        let row_off = row * width;
        for col in 0..width {
            let px = (row_off + col) * 4;
            let b = bgra[px] as i32;
            let g = bgra[px + 1] as i32;
            let r = bgra[px + 2] as i32;
            y_plane[row_off + col] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8;
        }
    }

    // UV plane: 2x2 subsampled, interleaved U,V pairs
    let uv_width = width / 2;
    let uv_height = height / 2;
    for row in 0..uv_height {
        let src_row = row * 2;
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
            let r = r_sum >> 2;
            let g = g_sum >> 2;
            let b = b_sum >> 2;
            let uv_off = (row * uv_width + col) * 2;
            // U
            uv_plane[uv_off] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            // V
            uv_plane[uv_off + 1] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }
}

/// Convert RGBA pixels to NV12 using fixed-point BT.601 coefficients.
fn rgba_to_nv12(rgba: &[u8], nv12: &mut [u8], width: usize, height: usize) {
    let y_size = width * height;
    let (y_plane, uv_plane) = nv12.split_at_mut(y_size);

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

    let uv_width = width / 2;
    let uv_height = height / 2;
    for row in 0..uv_height {
        let src_row = row * 2;
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
            let uv_off = (row * uv_width + col) * 2;
            uv_plane[uv_off] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            uv_plane[uv_off + 1] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }
}
