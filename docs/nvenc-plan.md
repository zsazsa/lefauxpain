# Add NVENC Hardware Encoding for Screen Share

## Context

The desktop screen share currently has two H.264 encoding paths: VAAPI (hardware, Intel/AMD) and openh264 (software fallback). On your RTX 3090, VAAPI doesn't work so it falls back to CPU encoding, which is slow at 1080p. Adding NVENC will offload encoding to the GPU.

## Approach

Use the `nvidia-video-codec-sdk` crate (v0.4.0) for direct NVENC access. No FFmpeg dependency needed. It vendors the SDK headers, so only `libnvidia-encode.so` (from the NVIDIA driver) is needed at build/link time.

### Encoder cascade in `create_encoder()`:
```
NVENC (if feature enabled + GPU available) → VAAPI → openh264 software
```

## Key Design Decisions

**Input format:** PipeWire captures BGRA. NVENC's `NV_ENC_BUFFER_FORMAT_ARGB` is BGRA in little-endian byte order — so we can pass frames directly with zero CPU color conversion. This is a big win over VAAPI (which needs BGRA→NV12) and openh264 (BGRA→I420).

**IDR keyframes:** The crate's safe API lacks `encodePicFlags` for on-demand IDR forcing. Two options:
- Set `gopLength = 60` in the encoder config (periodic IDR every 60 frames, matching the current capture loop behavior)
- Or fork the crate to add the flag

Since PLI from the SFU is already unhandled (per existing design), periodic IDR via `gopLength` is sufficient. `force_keyframe()` will be a no-op.

**Buffer pitch:** `Buffer::write()` does a raw memcpy without pitch awareness. If NVENC's internal pitch differs from `width * 4`, frames will be garbled. We'll read the pitch from the locked buffer and do row-by-row copying when pitch != stride.

**System memory input:** Use `session.create_input_buffer()` (host/CPU memory). NVENC handles the CPU→GPU transfer internally.

## Files to Modify

### 1. `desktop/src-tauri/Cargo.toml`
Add feature and dependencies:
```toml
[features]
default = ["vaapi", "nvenc"]
vaapi = ["cros-codecs"]
nvenc = ["nvidia-video-codec-sdk", "cudarc"]

[target.'cfg(target_os = "linux")'.dependencies]
nvidia-video-codec-sdk = { version = "0.4", optional = true }
cudarc = { version = "0.16", optional = true }
```

### 2. `desktop/src-tauri/src/screen/nvenc.rs` (new file)
~150-200 lines. Structure mirrors `vaapi.rs`:

```rust
pub struct NvencEncoder { ... }

impl NvencEncoder {
    pub fn try_new(width: u32, height: u32, bitrate_kbps: u32) -> Option<Self> {
        // 1. CudaContext::new(0)
        // 2. Encoder::initialize_with_cuda(ctx)
        // 3. Get preset config (P4, ultra-low-latency tuning)
        // 4. Set CBR rate control, bitrate, gopLength=60
        // 5. start_session(ARGB format)
        // 6. Pre-allocate 2 input buffers + 2 output bitstreams
        // Returns None on any failure (no NVIDIA GPU, driver too old, etc.)
    }
}

impl ScreenEncoder for NvencEncoder {
    fn encode(&mut self, frame: &FrameData) -> Result<Vec<u8>, ...> {
        // 1. If frame is BGRA: pass directly (ARGB = BGRA on LE)
        //    If frame is RGBA: need byte swizzle to BGRA
        // 2. Lock input buffer, copy with pitch awareness, unlock
        // 3. encode_picture() with autoselect picture type
        // 4. Lock output bitstream, copy NAL data, return
    }

    fn force_keyframe(&mut self) {
        // No-op — gopLength handles periodic IDR
    }
}
```

### 3. `desktop/src-tauri/src/screen/encoder.rs`
Update `create_encoder()` to try NVENC first:
```rust
pub fn create_encoder(...) -> Result<Box<dyn ScreenEncoder>, ...> {
    #[cfg(feature = "nvenc")]
    {
        if let Some(enc) = super::nvenc::NvencEncoder::try_new(width, height, bitrate_kbps) {
            return Ok(Box::new(enc));
        }
    }
    #[cfg(feature = "vaapi")]
    { ... }  // existing
    Ok(Box::new(SoftwareEncoder::new(...)?))  // existing
}
```

### 4. `desktop/src-tauri/src/screen/mod.rs`
Add conditional module:
```rust
#[cfg(feature = "nvenc")]
mod nvenc;
```

## Verification

1. `cargo build` — compiles with both features
2. Run the desktop app, start screen share, check stderr for:
   - `[screen] NVENC encoder initialized (WxH, Xkbps)` → hardware path
   - `[screen] Using software encoder (openh264)` → fallback (shouldn't happen on your RTX 3090)
3. Verify the shared screen is visible to other users in the voice channel (correct colors, no garbled frames)
4. Test the standalone VAAPI probe still works on Intel systems (feature-gated, no regression)
