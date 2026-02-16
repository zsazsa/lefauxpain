# VAAPI Hardware-Accelerated Screen Share Encoding (Linux)

## Problem

The current desktop screen share pipeline is entirely CPU-bound:

```
PipeWire frame (BGRA, mmap'd shared memory)
  → stride-stripping memcpy (~240 MB/s at 1080p/30fps)
  → bgra_to_i420() scalar loops (~60M arithmetic ops/s)
  → openh264 software H.264 encode (1-2 CPU cores)
  → RTP packetization → WebRTC
```

At 1080p/30fps this saturates CPU and produces noticeably laggy, low-quality
video compared to browser-based sharing (which uses hardware encoding).

## Goal

Replace the CPU pipeline with GPU-accelerated encoding via VAAPI:

```
PipeWire DMA-BUF fd (compositor GPU buffer, zero CPU copy)
  → VAAPI VPP: BGRA → NV12 (GPU color conversion)
  → VAAPI H.264 encode (GPU, near-zero CPU)
  → map bitstream (~30 KB/frame) → RTP → WebRTC
```

The only CPU work remaining is the tiny bitstream memcpy into the RTP
packetizer. Everything else happens on the GPU with zero-copy buffer sharing.

## Scope

**Linux only.** VAAPI is a Linux-specific API. Windows/macOS have their own
hardware encoding APIs (Media Foundation / VideoToolbox) which are out of scope.

**Intel and AMD GPUs.** NVIDIA does not support VAAPI encoding (only decode via
a shim). NVIDIA users fall back to software encoding. See vendor support table
below.

## Current Bottlenecks (capture.rs)

| Bottleneck | Location | Cost | VAAPI fix |
|---|---|---|---|
| Stride-stripping memcpy | `process` callback, FullFrame/Cropped paths | ~240 MB/s at 1080p | Eliminated — GPU reads with stride directly |
| `bgra_to_i420()` scalar loops | encode loop, before `encoder.encode()` | ~60M iterations/s | VAAPI VPP does BGRA→NV12 on GPU |
| openh264 software encode | `Encoder::encode()` | 1-2 CPU cores | VAAPI H.264 encode, near-zero CPU |
| Forced IDR every 60 frames | `force_intra_frame()` | CPU spike on IDR | Hardware IDR is cheap |

## Architecture

### Pipeline Overview

```
                      DMA-BUF path (zero-copy)          SHM path (fallback)
                      ─────────────────────────         ─────────────────────
PipeWire              DMA-BUF fd from compositor        mmap'd pixel buffer
    │                         │                                │
    v                         v                                v
Format Check          Import fd as VASurface            Upload to VASurface
    │                 (vaCreateSurfaces +                (vaMapBuffer memcpy)
    │                  DRM_PRIME import)
    │                         │                                │
    v                         └──────────────┬─────────────────┘
VAAPI VPP                                    v
                              BGRA/NV12 VASurface
                                      │
                                      v
                              VAAPI H.264 Encode
                              (vaBeginPicture / vaEndPicture)
                                      │
                                      v
                              Map coded buffer (~30 KB)
                                      │
                                      v
                              webrtc-rs RTP packetization
```

### Runtime Fallback

```rust
fn create_encoder(width: u32, height: u32) -> Box<dyn ScreenEncoder> {
    match VaapiEncoder::try_new(width, height) {
        Ok(enc) => {
            eprintln!("[screen] Using VAAPI hardware encoder");
            Box::new(enc)
        }
        Err(e) => {
            eprintln!("[screen] VAAPI unavailable ({}), using software encoder", e);
            Box::new(OpenH264Encoder::new(width, height))
        }
    }
}
```

Detection sequence:
1. Open `/dev/dri/renderD128` (or enumerate `/dev/dri/renderD*`)
2. `vaGetDisplayDRM()` + `vaInitialize()`
3. Query `VAProfileH264Main` + `VAEntrypointEncSlice`
4. If any step fails → software fallback

### Encoder Trait

```rust
trait ScreenEncoder {
    /// Encode a frame. Returns H.264 NAL units.
    fn encode(&mut self, frame: &FrameData) -> Result<Vec<u8>>;

    /// Force next frame to be an IDR keyframe.
    fn force_keyframe(&mut self);
}
```

Both `VaapiEncoder` and `OpenH264Encoder` implement this trait. The encode
loop doesn't need to know which backend is active.

## Crate Dependencies

| Purpose | Crate | Notes |
|---|---|---|
| VAAPI bindings | `cros-libva` | Safe Rust wrapper for libva. DMA-BUF import support. Requires `libva-dev` at build time. |
| H.264 VAAPI encode | `cros-codecs` | High-level encoder built on cros-libva. H.264/VP9/AV1 VAAPI backend. |
| PipeWire capture | `pipewire` 0.8 (existing) | Need to add DMA-BUF format negotiation |
| Software fallback | `openh264` (existing) | Current encoder, kept as fallback |

`cros-libva` + `cros-codecs` are the ChromeOS team's libraries — mature, used
in production by crosvm. Preferred over FFmpeg wrappers (avoids massive dep)
or unmaintained alternatives.

### Build Dependencies (user's system)

```bash
# Debian/Ubuntu
sudo apt install libva-dev libva-drm2 vainfo

# Verify VAAPI works
vainfo  # Should show VAEntrypointEncSlice for H.264
```

## PipeWire Changes

### Current Format Negotiation

The stream currently negotiates only raw pixel formats over shared memory:

```rust
// Current: only pixel format, no DMA-BUF
VideoFormat: BGRA | RGBA | BGRx | RGBx
// No VideoSize constraint
// No VideoModifier (DRM modifier)
// No SPA_DATA_DmaBuf data type
```

### Required Changes

1. **Query VAAPI for supported DRM formats/modifiers** before connecting the
   PipeWire stream. Build the format pod with these modifiers so PipeWire can
   negotiate a GPU-compatible format.

2. **Add `SPA_DATA_DmaBuf` to buffer data type** in the `SPA_PARAM_Buffers`
   pod. This tells PipeWire we can accept DMA-BUF file descriptors.

3. **In the `process` callback**, check `data.type`:
   - `SPA_DATA_DmaBuf` → extract fd, import into VASurface (zero-copy)
   - `SPA_DATA_MemFd` / `SPA_DATA_MemPtr` → mmap, upload to VASurface

4. **Fallback**: If DMA-BUF negotiation fails (e.g., X11 without GPU
   compositing), the stream falls back to shared memory automatically.

### process Callback (DMA-BUF path)

```rust
// Pseudocode
let d = &mut datas[0];
if d.type_() == SPA_DATA_DmaBuf {
    let dmabuf_fd = d.as_raw_fd();
    // Import into VAAPI surface — no memcpy, no mmap
    encoder.encode_dmabuf(dmabuf_fd, width, height, stride, drm_format, modifier);
} else {
    // Shared memory fallback
    let raw = d.data().unwrap();
    encoder.encode_shm(raw, width, height, stride, is_bgra);
}
```

## VAAPI Encode Flow (per frame)

```
1. Import input surface
   - DMA-BUF: vaCreateSurfaces() with VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME
   - SHM: vaCreateSurfaces() + vaMapBuffer() to upload pixels

2. Color convert (if needed)
   - If input is BGRA: VAAPI VPP pipeline converts to NV12
   - If input is NV12: pass through directly (unlikely from compositor)

3. Encode
   vaBeginPicture(context, nv12_surface)
   vaRenderPicture(context, [seq_param, pic_param, slice_param, ...])
   vaEndPicture(context)

4. Sync + extract bitstream
   vaSyncSurface(display, nv12_surface)
   vaMapBuffer(display, coded_buf) → H.264 NAL units
   Copy NALs to bytes::Bytes for RTP packetization
   vaUnmapBuffer(display, coded_buf)
```

### Encoder Parameters

```
Profile:        H.264 Main (better compression than Baseline)
Level:          4.1 (supports 1080p/30)
Rate control:   CBR at 5 Mbps (matching current config)
IDR interval:   60 frames (~2s) — same as current
B-frames:       0 (low latency)
Slices:         1 per frame
Low-power mode: Enable if available (uses fixed-function encoder)
```

## GPU Vendor Support

| Vendor | VAAPI Encode? | Driver | Notes |
|---|---|---|---|
| **Intel** | Yes | `intel-media-driver` (iHD) | Full support, Broadwell (2014) and newer. Reference implementation. |
| **AMD** | Yes | `mesa-va-drivers` (radeonsi) | VCN hardware. Check Mesa version for RDNA3 support. |
| **NVIDIA** | **No** | N/A | `nvidia-vaapi-driver` is decode-only. NVENC is a separate API. Falls back to software. |

## File Changes

| File | Change |
|---|---|
| `desktop/src-tauri/Cargo.toml` | Add `cros-libva`, `cros-codecs` deps (linux only) |
| `desktop/src-tauri/src/screen/capture.rs` | Extract `ScreenEncoder` trait, DMA-BUF support in PipeWire callback |
| `desktop/src-tauri/src/screen/vaapi.rs` | **NEW** — VAAPI encoder: init, surface management, encode loop |
| `desktop/src-tauri/src/screen/software.rs` | **NEW** — OpenH264 encoder wrapped in `ScreenEncoder` trait |

## Implementation Steps

### Phase 1: Encoder Abstraction

1. Define `ScreenEncoder` trait with `encode()` and `force_keyframe()`
2. Wrap current openh264 code in `SoftwareEncoder` implementing the trait
3. Wire the trait into the encode loop (no behavior change yet)
4. Verify everything still works

### Phase 2: VAAPI Encoder (SHM path)

1. Add `cros-libva` + `cros-codecs` dependencies
2. Implement `VaapiEncoder::try_new()` — detect GPU, create encode context
3. Implement `encode()` — upload mmap'd pixels to VASurface, encode, extract bitstream
4. Add runtime fallback: try VAAPI first, fall back to software
5. Test on Intel and AMD systems

### Phase 3: DMA-BUF Zero-Copy

1. Modify PipeWire format negotiation to offer DMA-BUF data type + modifiers
2. In `process` callback, detect DMA-BUF and pass fd to encoder
3. Import DMA-BUF fd directly as VASurface (zero CPU copy)
4. Add VAAPI VPP color conversion (BGRA → NV12) on GPU
5. Test end-to-end zero-copy path

### Phase 4: Polish

1. Handle resolution changes (recreate encoder surfaces)
2. Handle GPU errors gracefully (fall back to software mid-stream)
3. Log encoder type and performance metrics
4. Test on various hardware (Intel iGPU, AMD dGPU, NVIDIA fallback)

## Preview Thumbnail

The MJPEG preview thumbnail (`make_preview_jpeg`) stays on CPU. It's cheap
(480px wide, JPEG Q55) and only runs at 30fps. Not worth the complexity of
GPU-accelerated thumbnailing.

## Risks

- **cros-codecs API stability**: The crate is relatively new and API may change.
  Pin to a specific version.
- **DRM modifier negotiation**: Different compositors (GNOME/KDE/Sway) may
  offer different modifiers. Need testing across desktops.
- **Multi-GPU systems**: Need to pick the right render node when multiple GPUs
  are present. Use the same GPU the compositor uses.
- **Wayland only for DMA-BUF**: X11 screen capture may not provide DMA-BUFs.
  SHM fallback handles this but loses zero-copy benefit.
