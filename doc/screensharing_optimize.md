# Screen Sharing Optimization Plan

## Current State

### Desktop (Tauri / Linux)
- PipeWire capture → BGRA → float I420 conversion → CPU VP8 encode → WebRTC
- 15 FPS, 2000 kbps, no encoder speed tuning
- vpx-encode crate: minimal config (5 fields), hardcoded `VPX_DL_REALTIME`, 8 threads, no speed preset for VP8
- Full BGRA frame copy from PipeWire (MAP_BUFFERS)
- JPEG preview thumbnails every 500ms

### Browser (Chrome, Firefox, etc.)
- `getDisplayMedia({ video: { cursor: "always" }, audio: true })` — no framerate or resolution constraints
- RTCPeerConnection with default codec negotiation — no preference for H.264 vs VP8
- No bitrate control (`setParameters()` not called for screen share, only for voice)
- No `contentHint` set on video track
- Browser handles encoding internally (may or may not use hardware)

### SFU (Go / Pion)
- Screen room registers VP8 (PT 96) + Opus (PT 111) only
- Default interceptors — no explicit NACK (unlike voice room which adds NACK responder/generator)
- No bitrate or framerate limits in PeerConnection config
- Offer created with `CreateOffer(nil)` — no constraints

## Phase 1: Quick Wins (no architecture changes)

### 1A. Desktop — FPS and Bitrate

**Files**: `desktop/src-tauri/src/screen/capture.rs`

Change two constants:
```rust
const FRAME_DURATION: Duration = Duration::from_millis(33);  // 30 FPS (was 67ms / 15 FPS)
const BITRATE_KBPS: u32 = 5000;                              // 5 Mbps (was 2000)
```

30 FPS doubles smoothness. 5 Mbps gives enough headroom for sharp text at 1080p. Screen content (text, UI) compresses well so effective quality is much higher than 5 Mbps video content.

### 1B. Desktop — Integer I420 Conversion

**Files**: `desktop/src-tauri/src/screen/capture.rs`

Replace float BT.601 math with fixed-point integer arithmetic. Current code does ~10 float ops per pixel:
```rust
// Current (slow)
y_plane[i] = (16.0 + 65.481 * r / 255.0 + 128.553 * g / 255.0 + 24.966 * b / 255.0) as u8;
```

Replace with integer (no division, no float):
```rust
// Fixed-point BT.601 (shift by 16 bits for precision)
// Y =  16 + ( 66*R + 129*G +  25*B + 128) >> 8
// U = 128 + (-38*R -  74*G + 112*B + 128) >> 8
// V = 128 + (112*R -  94*G -  18*B + 128) >> 8
let y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
```

Expected speedup: ~3-5x for color conversion. At 1920x1080 30fps this saves ~5-10ms per frame.

### 1C. Browser — getDisplayMedia Constraints

**Files**: `client/src/lib/screenshare.ts`

Add framerate and resolution hints:
```typescript
screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: {
    cursor: "always",
    frameRate: { ideal: 30 },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: true,
});
```

Browsers may ignore these (they're hints, not hard constraints), but Chrome respects `frameRate` for screen capture.

### 1D. Browser — Bitrate Control

**Files**: `client/src/lib/screenshare.ts`

After adding tracks to the PeerConnection, set max bitrate on the video sender:
```typescript
const videoTrack = screenStream.getVideoTracks()[0];
const sender = screenPC.addTrack(videoTrack, screenStream);
const params = sender.getParameters();
if (!params.encodings || params.encodings.length === 0) {
  params.encodings = [{}];
}
params.encodings[0].maxBitrate = 6_000_000; // 6 Mbps
sender.setParameters(params);
```

Without this, browser may default to a low bitrate. Screen text looks blurry at < 2 Mbps.

### 1E. Browser — Content Hint

**Files**: `client/src/lib/screenshare.ts`

Tell the browser this is screen content (optimize for sharpness over motion):
```typescript
const videoTrack = screenStream.getVideoTracks()[0];
videoTrack.contentHint = "detail";
```

This hints the encoder to preserve edges/text at the expense of motion smoothness — exactly right for screen sharing.

### 1F. SFU — Add NACK Interceptors for Screen Room

**Files**: `server/sfu/sfu.go`

The voice room explicitly registers NACK responder/generator interceptors, but the screen room only uses default interceptors. NACK (Negative ACKnowledgement) enables retransmission of lost packets, which is critical for video quality.

Add the same NACK interceptors used for voice:
```go
// Register NACK for screen room (like voice room)
nackResp, _ := nack.NewResponderInterceptor()
screenIR.Add(nackResp)
nackGen, _ := nack.NewGeneratorInterceptor()
screenIR.Add(nackGen)
```

This reduces visual artifacts from packet loss without any encoding changes.

## Phase 2: Better Codec (medium effort)

### 2A. SFU — Add H.264 Support

**Files**: `server/sfu/sfu.go`, `server/sfu/screen_room.go`

Register H.264 codec alongside VP8 in the screen media engine:
```go
if err := screenME.RegisterCodec(webrtc.RTPCodecParameters{
    RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType:    webrtc.MimeTypeH264,
        ClockRate:   90000,
        SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    },
    PayloadType: 102,
}, webrtc.RTPCodecTypeVideo); err != nil { ... }
```

Register H.264 **before** VP8 so it's preferred in the SDP offer. All modern browsers support H.264 decoding (often hardware-accelerated).

The screen room track forwarding needs to handle both codecs — Pion does this automatically when both are registered.

### 2B. Browser — SDP Codec Preference

**Files**: `client/src/lib/screenshare.ts`

After creating the PeerConnection, use `setCodecPreferences()` on the transceiver to prefer H.264:
```typescript
const transceiver = screenPC.getTransceivers().find(t => t.receiver.track.kind === "video");
if (transceiver) {
  const codecs = RTCRtpReceiver.getCapabilities("video")?.codecs || [];
  const h264 = codecs.filter(c => c.mimeType === "video/H264");
  const rest = codecs.filter(c => c.mimeType !== "video/H264");
  transceiver.setCodecPreferences([...h264, ...rest]);
}
```

H.264 provides better quality per bit than VP8, especially for screen content.

### 2C. Desktop — Switch to openh264 or x264

**Files**: `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/src/screen/capture.rs`, `desktop/src-tauri/src/screen/peer.rs`

Replace `vpx-encode` with an H.264 encoder. Options:

**Option A: openh264 crate** (Cisco's BSD-licensed H.264 encoder)
- Pros: Simple API, free, no patent issues
- Cons: Slower than x264, no hardware accel
- Crate: `openh264` or `openh264-sys2`

**Option B: x264 via FFI**
- Pros: Fastest CPU H.264 encoder, excellent screen content mode (`--tune zerolatency --preset ultrafast`)
- Cons: GPL license, need FFI bindings
- Crate: `x264` or raw `x264-sys`

**Option C: Raw vpx-sys with VP8 speed tuning** (keep VP8 but tune it)
- Fork `vpx-encode` or use `vpx-sys` directly
- Set `VP8E_SET_CPUUSED` to 10-16 (fastest, lower quality)
- Set `VP8E_SET_SCREEN_CONTENT_MODE = 1` if available
- Pros: No SFU changes needed
- Cons: VP8 is inherently less efficient than H.264

In `peer.rs`, register H.264 codec instead of/alongside VP8:
```rust
let h264_codec = RTCRtpCodecCapability {
    mime_type: "video/H264".to_string(),
    clock_rate: 90000,
    sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f".to_string(),
    ..Default::default()
};
```

Use `TrackLocalStaticSample` with H.264 MIME type. The RTP packetization for H.264 (RFC 6184) is handled by webrtc-rs.

## Phase 3: Hardware Encoding (large effort)

### 3A. Desktop — VAAPI Hardware Encoding (Intel/AMD)

**Files**: New `desktop/src-tauri/src/screen/hw_encode.rs`

Use VA-API for hardware H.264 encoding:
- Crate: `va` or raw `libva-sys` FFI
- Pipeline: PipeWire BGRA → VA-API surface upload → H.264 encode → NAL units → RTP
- Intel iGPU and AMD APU/dGPU support
- Encoding 1080p30 takes <1ms (vs 30-50ms CPU)

Requirements: `libva-dev`, `libva-drm2`, VA-API driver (intel-media-va-driver or mesa-va-drivers).

Detection: Try VAAPI first, fall back to CPU if unavailable.

### 3B. Desktop — NVENC Hardware Encoding (NVIDIA)

**Files**: New `desktop/src-tauri/src/screen/hw_encode.rs`

Use NVIDIA's NVENC for hardware H.264 encoding:
- Crate: `nvenc` or NVIDIA Video Codec SDK FFI
- Pipeline: PipeWire BGRA → CUDA upload → NVENC H.264 → NAL units → RTP
- Dedicated encode ASIC on all GeForce GTX 600+ / Quadro K-series+
- Even faster than VAAPI on supported hardware

Requirements: NVIDIA driver 470+, `libnvidia-encode`.

### 3C. Desktop — DMA-BUF Zero-Copy Capture

**Files**: `desktop/src-tauri/src/screen/capture.rs`

Replace `StreamFlags::MAP_BUFFERS` with DMA-BUF:
```rust
pipewire::stream::StreamFlags::AUTOCONNECT | pipewire::stream::StreamFlags::ALLOC_BUFFERS
```

With DMA-BUF, PipeWire gives us a GPU buffer handle instead of copying pixels to CPU memory. Combined with VAAPI/NVENC, the entire pipeline stays on GPU:
```
PipeWire DMA-BUF → GPU surface → hardware encode → CPU (just NAL units)
```

No CPU pixel touching at all. The CPU only handles RTP packetization.

This requires DMA-BUF format negotiation in the SPA params (add `SPA_DATA_DmaBuf` to the param list).

### 3D. Desktop — GStreamer Pipeline (alternative to manual pipeline)

Instead of manually managing PipeWire + color conversion + encoding, use GStreamer which orchestrates everything:

```
pipewiresrc → videoconvert → vaapih264enc → appsink
```

GStreamer handles:
- PipeWire capture with DMA-BUF passthrough
- Optimal color conversion (GPU if available)
- Hardware encoder selection (VAAPI → NVENC → software fallback)
- Buffer management and threading

Trade-off: Adds GStreamer as a dependency (~20MB), but eliminates most of our capture/encode code.

## Phase 4: Adaptive and Polish

### 4A. Adaptive Bitrate (all platforms)

Monitor network conditions (RTT, packet loss from RTCP sender reports) and adjust bitrate dynamically:
- Good network (RTT < 50ms, loss < 1%): 6 Mbps
- Medium (RTT < 150ms, loss < 3%): 3 Mbps
- Poor (RTT > 150ms, loss > 3%): 1.5 Mbps

For desktop: adjust `encoder.bitrate` dynamically. For browser: adjust via `sender.setParameters()`.

The SFU can relay RTCP feedback to the presenter's WS connection for desktop clients.

### 4B. Keyframe Request Handling

When a new viewer joins mid-stream, they need a keyframe (IDR) to start decoding. Currently the SFU generates a PLI (Picture Loss Indication) via default interceptors, but this could be made more responsive:
- SFU sends PLI immediately when a viewer subscribes
- Desktop encoder listens for PLI and forces an IDR frame
- Reduces time-to-first-frame for new viewers

### 4C. Variable Frame Rate

Screen content is often static (user reading, not scrolling). Detect when frames are identical and reduce frame rate to save bandwidth:
- Compare frame hash/checksum with previous frame
- If identical for N consecutive frames, drop to 5 FPS
- Resume 30 FPS on first changed frame
- Saves bandwidth and CPU during idle periods

## Platform-Specific Notes

### Linux (current — PipeWire)
All phases above apply directly. PipeWire + xdg-desktop-portal is the capture mechanism. VAAPI works on Intel/AMD, NVENC on NVIDIA. DMA-BUF is native to PipeWire.

### Windows (future Tauri build)
- **Capture**: Windows Desktop Duplication API (DXGI) or Windows.Graphics.Capture API. Both provide GPU-resident frames.
- **Color conversion**: Direct3D compute shader (BGRA→NV12), or just pass to hardware encoder directly.
- **Hardware encode**: Media Foundation Transform (MFT) wraps both Intel QSV and NVIDIA NVENC. Alternatively, use NVENC SDK directly for NVIDIA.
- **CPU fallback**: openh264 or x264 (same as Linux).
- **Crates**: `windows` crate for Win32/COM APIs, `windows-capture` crate for Desktop Duplication.
- **DMA-BUF equivalent**: D3D11 texture sharing — DXGI surfaces can be passed directly to MFT encoder without CPU copy.

### macOS (future Tauri build)
- **Capture**: `SCScreensharingKit` (macOS 12.3+) or `CGDisplayStream` (older). SCScreensharingKit is Apple's modern screen capture API with per-window capture and efficiency.
- **Color conversion**: Delivered as `IOSurface` / `CVPixelBuffer` in BGRA or NV12. VideoToolbox accepts these directly.
- **Hardware encode**: VideoToolbox (VTCompressionSession) — unified API for Apple Silicon and Intel hardware H.264/HEVC encoding. Always available on macOS.
- **CPU fallback**: Not needed — VideoToolbox is always present.
- **Crates**: `core-foundation`, `core-video`, `core-media` for Apple framework bindings. May need raw FFI for VideoToolbox.
- **Zero-copy**: `IOSurface` from capture → VideoToolbox encoder → compressed NAL units. No CPU pixel touching.

### Browser (all platforms)
Phases 1C-1E and 2B apply. The browser handles capture and encoding internally. Our control is limited to:
- `getDisplayMedia()` constraints (framerate, resolution)
- `RTCRtpSender.setParameters()` (bitrate)
- `contentHint` (detail vs motion)
- `setCodecPreferences()` (prefer H.264)
- The browser already uses hardware encoding when available (Chrome uses VAAPI on Linux, MFT on Windows, VideoToolbox on macOS)

### Platform Detection Strategy
The Tauri desktop app can detect available hardware at startup:
```rust
// Pseudocode
fn select_encoder() -> EncoderType {
    #[cfg(target_os = "linux")]
    if vaapi_available() { return EncoderType::VAAPI; }
    #[cfg(target_os = "linux")]
    if nvenc_available() { return EncoderType::NVENC; }

    #[cfg(target_os = "windows")]
    if mft_h264_available() { return EncoderType::MFT; }

    #[cfg(target_os = "macos")]
    return EncoderType::VideoToolbox; // always available

    return EncoderType::SoftwareH264; // CPU fallback
}
```

## Impact Summary

| Phase | Change | FPS | Latency | Quality | Effort |
|-------|--------|-----|---------|---------|--------|
| 1A | Desktop 30fps/5Mbps | 2x | Same | Much better | Trivial |
| 1B | Integer I420 | Same | -5ms/frame | Same | Small |
| 1C | Browser framerate hint | ~2x | Same | Same | Trivial |
| 1D | Browser bitrate control | Same | Same | Much better | Trivial |
| 1E | Browser content hint | Same | Same | Better text | Trivial |
| 1F | SFU NACK for screen | Same | Same | Fewer artifacts | Small |
| 2A-C | H.264 codec | Same | -10ms encode | Better per bit | Medium |
| 3A-B | Hardware encode | Same | -25ms encode | Same or better | Large |
| 3C | DMA-BUF zero-copy | Same | -4ms copy | Same | Large |
| 4A | Adaptive bitrate | Same | Same | Adapts to network | Medium |
| 4C | Variable frame rate | Dynamic | Same | Same | Small |

Phase 1 alone (all trivial/small changes) should bring the experience from "noticeably laggy" to "competitive with Zoom for typical screen sharing."
