# Desktop Screen Sharing (Tauri / Linux)

## Overview

Screen sharing on the Tauri desktop app cannot use the browser's `getDisplayMedia()` API because webkit2gtk lacks `RTCPeerConnection`. The solution mirrors what was done for voice: implement WebRTC natively in Rust and bridge to the frontend via Tauri IPC.

The Go SFU server's `ScreenRoom` is configured for VP8 — no server-side changes were needed.

**Desktop users can present but cannot watch** (watching requires `RTCPeerConnection` to receive video, which webkit2gtk doesn't have). Viewing stays browser-only.

## Architecture

```
User clicks [SHARE]
  → JS: tauriInvoke("screen_start")
  → Rust: xdg-desktop-portal picker → PipeWire screencast → VP8 encode → WebRTC track
  → JS: send WS "screen_share_start"
  → Server: creates recv-only PeerConnection → sends "webrtc_screen_offer"
  → JS: tauriInvoke("screen_handle_offer", {sdp}) → Rust answers
  → ICE exchange: Rust ←→ Tauri events ←→ JS ←→ WS ←→ Server
  → Connected: capture frames → BGRA → I420 → VP8 → RTP → SFU → browser viewers
```

### Rust modules (`desktop/src-tauri/src/screen/`)

| File | Purpose |
|------|---------|
| `mod.rs` | `ScreenEngine` + 4 IPC commands (`screen_start`, `screen_stop`, `screen_handle_offer`, `screen_handle_ice`). Event forwarding loop for ICE candidates. |
| `peer.rs` | VP8 `RTCPeerConnection` via webrtc-rs. Registers VP8 codec (90kHz, PT 96) and Opus (48kHz, 2ch, PT 111). Uses `TrackLocalStaticSample` for video. |
| `capture.rs` | PipeWire capture + VP8 encoding + JPEG preview generation. The bulk of the complexity lives here. |

### Frontend changes

| File | Change |
|------|--------|
| `stores/voice.ts` | Added `desktopPresenting` and `desktopPreviewUrl` signals |
| `lib/screenshare.ts` | `isDesktop` routing: `tauriInvoke` for start/stop/offer/ice instead of browser WebRTC |
| `lib/events.ts` | Tauri event listeners for `screen:ice_candidate` and `screen:preview` |
| `components/VoiceChannel/VoiceChannel.tsx` | Shows `<img>` with JPEG preview data URL when desktop is presenting |
| `components/VoiceChannel/VoiceControls.tsx` | [SHARE] button enabled on desktop (was hidden behind `isDesktop` guard) |

## Capture Pipeline (capture.rs)

### Dependencies

```toml
ashpd = "0.9"          # xdg-desktop-portal (screen picker)
pipewire = "0.8"        # PipeWire client bindings
libspa = "0.8"          # SPA pod serialization for format params
vpx-encode = "0.6"      # VP8 encoding
image = { version = "0.25", features = ["jpeg"] }  # JPEG preview thumbnails
base64 = "0.22"         # data URL encoding
```

System packages: `libvpx-dev`, `libpipewire-0.3-dev`, `libclang-dev`.

### Pipeline stages

1. **Portal** (`portal_start_screencast`) — Uses ashpd to open an xdg-desktop-portal ScreenCast session. Shows the GNOME picker for monitor/window selection. Returns PipeWire node ID, dimensions, and fd.

2. **PipeWire thread** (`pipewire_capture_loop`) — Dedicated OS thread (not tokio). Connects to PipeWire via the portal fd, receives BGRA frames, performs alpha-based cropping, sends frame data through a `tokio::sync::mpsc` channel.

3. **VP8 encode loop** (`run_capture` / `spawn_blocking`) — Receives frames from the channel, converts BGRA→I420, encodes VP8, writes samples to the WebRTC track. Also emits JPEG preview thumbnails every 500ms via Tauri events.

### Key design decisions

- **`TrackLocalStaticSample`** (not `TrackLocalStaticRTP`) — handles VP8 RTP packetization automatically. The SFU's screen room matches with VP8.
- **~15 FPS** (`FRAME_DURATION = 67ms`) at 2000 kbps — reasonable for screen content.
- **Per-session stop flag** — each `start()` creates a new `Arc<AtomicBool>`. Old PipeWire threads keep their own flag (set to true) and don't interfere with new sessions.
- **Portal runs in IPC handler** — `screen_start` awaits the portal before returning `Ok` to the frontend. If the user cancels the picker, the error propagates and the frontend never tells the server it's sharing.

## What Worked

### PipeWire ScreenCast via xdg-desktop-portal
The ashpd crate provides a clean async API for the portal. The portal returns a PipeWire fd and node ID that we connect to directly. This works on both GNOME and KDE (Wayland).

### SPA format params via libspa pod serialization
Building format parameters using `libspa::pod::serialize::PodSerializer` with an `Object` of type `ObjectParamFormat`. Specifying `BGRA/RGBA/BGRx/RGBx` as format choices with no `VideoSize` constraint lets PipeWire deliver at the source's native size.

### VP8 via vpx-encode + TrackLocalStaticSample
Simple API: `Encoder::new(config)` → `encoder.encode(pts, &i420_data)` → `track.write_sample()`. The `TrackLocalStaticSample` type handles RTP packetization, so we just feed it raw VP8 packets.

### JPEG preview via Tauri events
Rust encodes a 480px-wide JPEG thumbnail every 500ms, base64-encodes it as a data URL, and emits it via `app.emit("screen:preview", &data_url)`. The frontend listens and sets an `<img src>`. Simple and effective.

### Parsing negotiated format from param_changed
Using `PodDeserializer::deserialize_from::<Value>(pod.as_bytes())` to extract the actual `VideoSize` rectangle from the finalized format. This gives the true frame dimensions regardless of display scaling.

## What Did NOT Work (and Fixes)

### xcap screenshot-based capture
**Problem**: The initial implementation used `xcap::Monitor::capture_image()` in a loop. This is a screenshot approach — it doesn't use the compositor's buffer sharing, is slow, and doesn't work for window-level capture on Wayland.

**Fix**: Switched to PipeWire ScreenCast via xdg-desktop-portal, which uses the compositor's native capture and supports both monitor and window selection.

### Empty PipeWire format params
**Problem**: Passing `&mut []` as stream params meant no format negotiation. PipeWire connected but never delivered frames.

**Fix**: Built proper SPA format params using `libspa::pod::serialize::PodSerializer` specifying accepted video formats (BGRA, RGBA, BGRx, RGBx).

### Fixed VideoSize in format params
**Problem**: Specifying a fixed `VideoSize` in the format params constrained PipeWire to deliver at that exact size. For multi-monitor setups or window capture, the natural size differs.

**Fix**: Removed the `VideoSize` property from format params entirely. Let PipeWire deliver at whatever size the source provides. Detect actual dimensions from the negotiated format via `param_changed`.

### Shared stop flag between capture sessions
**Problem**: `ScreenCapture` had a single `Arc<AtomicBool>` stop flag. When `start()` reset it to `false` for a new session, old PipeWire threads (still alive) saw `false` and resumed processing. This caused the share-stop-share cycle to get stuck — the UI showed [STOP] but nothing was actually sharing.

**Fix**: Create a **new** `Arc<AtomicBool>` for each `start()` call. Old threads keep their own clone (permanently `true`). They never resume.

### PipeWire thread never exiting
**Problem**: `mainloop.run()` blocks forever. When `stop()` aborted the tokio task, the PipeWire `std::thread` kept running because it's a separate OS thread. Threads leaked on every share/stop cycle.

**Fix**: Store a raw pointer to the `MainLoop` in the callback state (wrapped in a `MainLoopQuit` newtype with `unsafe impl Send`). When the stop flag is detected or the frame channel closes, the callback calls `mainloop.quit()`, which causes `run()` to return and the thread to exit cleanly.

### stream.disconnect() from within process callback
**Problem**: Calling `stream.disconnect()` from inside the PipeWire process callback caused a crash. PipeWire doesn't support modifying stream state from within its own callback.

**Fix**: Don't disconnect from the callback. Instead, set a `stopped` flag and call `mainloop.quit()`. The main loop exits, and the stream is cleaned up when the function returns and locals drop.

### Portal running asynchronously (race condition)
**Problem**: `capture.start()` spawned a tokio task that ran the portal asynchronously. The `screen_start` IPC returned `Ok` immediately, so the frontend told the server "I'm sharing" before the portal even opened. If the user cancelled the picker, the server thought sharing was active but no frames were sent. The UI got stuck.

**Fix**: Run `portal_start_screencast()` **inside** the `screen_start` IPC handler (before returning). The mutex is dropped first so the portal dialog doesn't block other IPC. If the portal fails, the error propagates to the frontend, which never sets `isPresenting` or sends `screen_share_start`.

### TrySendError::Full treated as fatal
**Problem**: When the VP8 encoder was slow (e.g., 3840x1080 dual monitor), the frame channel filled up. `try_send` returned `TrySendError::Full`, which was treated the same as `Closed`, causing the capture to abort.

**Fix**: Only treat `TrySendError::Closed` as fatal (receiver dropped). `Full` means backpressure — just drop the frame and continue.

### GNOME window capture: full screen with black mask
**Problem**: When selecting a window on GNOME, PipeWire delivers the **full monitor frame** with alpha=0 (transparent) for everything outside the selected window. Viewers saw the full screen with black everywhere except the window.

**Fix**: Alpha-based crop detection (`detect_alpha_crop`). Scans the alpha channel to find the bounding box of opaque pixels. Quick-checks the 4 corners first (if all opaque → full monitor capture, skip scan). Caches the crop result and re-detects every 30 frames (~2 seconds). When the crop result is `Empty` (fully transparent — window minimized), frames are skipped entirely.

### Deriving frame width from stride (stride padding)
**Problem**: `buf_w = stride / 4` computed the frame width from the byte stride. PipeWire may align the stride to 64/128 bytes, making it wider than the actual content. For example, a 1366px-wide window might have stride=5504 (1376 pixels). Using the stride-derived width caused diagonal shear — each row was offset by the padding pixels.

**Fix**: Use the portal-reported width (updated by parsing `param_changed` format) as the true content width. Use stride only for byte-offset calculations when reading rows from the PipeWire buffer. The full-frame copy strips padding by copying exactly `content_w * 4` bytes per row.

### Odd crop dimensions vs VP8 encoder (the 1321-pixel warp)
**Problem**: The alpha crop could produce odd dimensions (e.g., 1321x1034). The VP8 encoder requires even dimensions, so the encode loop rounded with `& !1` (→ 1320). But the frame data still had 1321-pixel rows. The I420 conversion interpreted data with 1320-pixel rows — every row shifted by 4 bytes, accumulating into a massive diagonal warp.

**Fix**: Round crop dimensions to even **at extraction time** in the PipeWire callback, before copying the frame data. The extracted buffer always has even-width rows. The encoder, I420 conversion, and JPEG preview all see consistent dimensions.

### param_changed checking wrong param ID
**Problem**: The code checked `id != 3`, which is `SPA_PARAM_EnumFormat` (the list of available formats during negotiation), not `SPA_PARAM_Format` (the finalized format, which is 4). The actual negotiated dimensions were never being read.

**Fix**: Check `id != ParamType::Format.as_raw()` to process only the finalized format. Parse the pod with `PodDeserializer` to extract the `VideoSize` rectangle.
