# Screen Sharing — Architecture & Implementation Plan

## Overview

Add screen sharing (video + system audio where possible) to GamersGuild voice channels. A user in a voice channel can share their screen; other users in the same channel see the video stream and hear the audio. One active screen share per channel at a time.

## Current Architecture

### SFU (server/sfu/)
- Pion-based Selective Forwarding Unit
- `MediaEngine` registers **Opus only** — no video codecs
- One `Room` per voice channel, one `Peer` per user
- Each peer has one `PeerConnection` with a single recv-only audio transceiver
- `OnTrack` creates a `TrackLocalStaticRTP` and forwards RTP to all other peers
- Renegotiation happens when peers join/leave (new offer sent via WS)

### WebRTC Client (client/src/lib/webrtc.ts)
- Single `RTCPeerConnection` per session
- Adds local audio track from `getUserMedia`
- `ontrack` feeds incoming streams into an audio pipeline (gain nodes)
- No video handling

### Signaling (server/ws/)
- `join_voice`, `leave_voice` — room management
- `webrtc_offer`, `webrtc_answer`, `webrtc_ice` — SDP/ICE exchange
- `voice_self_mute`, `voice_self_deafen`, `voice_speaking` — state updates

### Voice State (stores/voice.ts, sfu/peer.go)
- `VoiceState`: user_id, channel_id, self_mute, self_deafen, server_mute, speaking
- No screen sharing fields

---

## Design

### Approach: Separate PeerConnection for Screen Share

Use a **second PeerConnection** dedicated to screen sharing, rather than adding video tracks to the existing voice PC. Reasons:

1. **Isolation** — screen share lifecycle is independent of voice. Starting/stopping a share doesn't renegotiate the voice connection.
2. **Codec flexibility** — the voice PC uses Opus-only MediaEngine. Screen share needs VP8/VP9 + Opus. A separate MediaEngine avoids polluting the voice path.
3. **Simpler cleanup** — closing the screen share PC tears down exactly the screen share. No risk of disrupting audio.
4. **Bandwidth control** — can apply different bitrate/resolution constraints to the screen share PC.

### Data Flow

```
Presenter                          SFU                         Viewer
   |                                |                            |
   |-- getDisplayMedia() -------->  |                            |
   |   (video + audio tracks)       |                            |
   |                                |                            |
   |-- screen_share_start -------> |                             |
   |                                | -- screen_share_started -> |
   |                                |    (broadcasts to room)    |
   |                                |                            |
   |<---- webrtc_screen_offer ---- |                             |
   |---- webrtc_screen_answer ---> |                             |
   |                                | -- webrtc_screen_offer --> |
   |                                | <-- webrtc_screen_answer - |
   |                                |                            |
   |==== RTP video + audio ======> | ===== forward RTP =======> |
   |                                |                            |
   |-- screen_share_stop --------> |                             |
   |                                | -- screen_share_stopped -> |
```

### One Share Per Channel

The SFU enforces a single active screen share per room. If user A is sharing and user B tries to share, the server rejects it with an error message.

---

## Implementation

### Phase 1: SFU — Video Codec Support

**File: `server/sfu/sfu.go`**

Create a second `webrtc.API` instance for screen sharing with a MediaEngine that supports video codecs:

```go
// Screen share media engine: VP8 + Opus
screenME := &webrtc.MediaEngine{}
screenME.RegisterCodec(webrtc.RTPCodecParameters{
    RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType:  webrtc.MimeTypeVP8,
        ClockRate: 90000,
    },
    PayloadType: 96,
}, webrtc.RTPCodecTypeVideo)
screenME.RegisterCodec(webrtc.RTPCodecParameters{
    RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType:    webrtc.MimeTypeOpus,
        ClockRate:   48000,
        Channels:    2,
        SDPFmtpLine: "minptime=10;useinbandfec=1",
    },
    PayloadType: 111,
}, webrtc.RTPCodecTypeAudio)
```

Add NACK + PLI (Picture Loss Indication) interceptors for video reliability:

```go
// Add PLI for video keyframe requests
ir.Add(nack.NewResponderInterceptor())
ir.Add(nack.NewGeneratorInterceptor())
// Register PLI/FIR for video
webrtc.RegisterDefaultInterceptors(screenME, ir)
```

Store as `sfu.screenAPI`.

### Phase 2: SFU — Screen Share Room Logic

**File: `server/sfu/room.go`**

Add screen share state to `Room`:

```go
type Room struct {
    // ... existing fields ...
    screenShareUserID string                       // who is sharing (empty = nobody)
    screenPeers       map[string]*ScreenPeer       // viewer PCs
    screenPresenter   *ScreenPresenter             // presenter PC
}

type ScreenPresenter struct {
    UserID      string
    pc          *webrtc.PeerConnection
    videoTrack  *webrtc.TrackLocalStaticRTP
    audioTrack  *webrtc.TrackLocalStaticRTP  // may be nil (no audio)
}

type ScreenPeer struct {
    UserID string
    pc     *webrtc.PeerConnection
}
```

New methods:

- `StartScreenShare(userID string) error` — reject if someone else is sharing. Create a PeerConnection with recv-only video + recv-only audio transceivers. Send offer to presenter. Set `screenShareUserID`.
- `StopScreenShare(userID string)` — close presenter PC, close all viewer PCs, clear state.
- `AddScreenViewer(userID string) error` — create a send-only PC for a viewer. Add the presenter's local tracks. Send offer.
- `RemoveScreenViewer(userID string)` — close viewer PC.
- `HandleScreenAnswer(userID, sdp)` — route to presenter or viewer PC.
- `HandleScreenICE(userID, candidate)` — route to presenter or viewer PC.

When the presenter's `OnTrack` fires (video and/or audio), create local forwarding tracks and add them to all existing viewer PCs (renegotiate).

When a new user joins the voice channel while a screen share is active, automatically call `AddScreenViewer` for them.

When a user leaves the voice channel, call `RemoveScreenViewer`. If the presenter leaves, call `StopScreenShare`.

### Phase 3: Signaling — New WebSocket Messages

**File: `server/ws/handlers.go`**

New operations:

| Client → Server | Payload | Server Action |
|----------------|---------|---------------|
| `screen_share_start` | `{}` | Call `room.StartScreenShare(userID)`. Broadcast `screen_share_started` to room. |
| `screen_share_stop` | `{}` | Call `room.StopScreenShare(userID)`. Broadcast `screen_share_stopped` to room. |
| `webrtc_screen_answer` | `{ sdp: string }` | Route to `room.HandleScreenAnswer(userID, sdp)` |
| `webrtc_screen_ice` | `{ candidate: ICECandidateInit }` | Route to `room.HandleScreenICE(userID, candidate)` |

| Server → Client | Payload | Trigger |
|----------------|---------|---------|
| `screen_share_started` | `{ user_id: string }` | Broadcast when share begins |
| `screen_share_stopped` | `{ user_id: string }` | Broadcast when share ends |
| `webrtc_screen_offer` | `{ sdp: string }` | SFU sends offer for screen share PC |
| `webrtc_screen_ice` | `{ candidate: ICECandidateInit }` | SFU sends ICE candidate for screen share PC |
| `screen_share_error` | `{ error: string }` | Rejection (e.g., someone else is already sharing) |

**File: `server/ws/protocol.go`**

Add to `VoiceStatePayload`:

```go
type VoiceStatePayload struct {
    // ... existing fields ...
    ScreenSharing bool `json:"screen_sharing"`
}
```

Include `ScreenSharing` in the `ready` payload so clients know the current state on connect.

### Phase 4: Frontend — Screen Share WebRTC

**File: `client/src/lib/screenshare.ts`** (new)

```typescript
let screenPC: RTCPeerConnection | null = null;
let screenStream: MediaStream | null = null;

export async function startScreenShare() {
    // 1. getDisplayMedia (platform-dependent, see Phase 6)
    screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { max: 30 } },
        audio: true,  // request audio — may be denied by platform
    });

    // 2. Signal server
    send("screen_share_start", {});

    // 3. Handle the track ending (user clicks "Stop sharing" in browser/OS UI)
    screenStream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
    };
}

export function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }
    if (screenPC) {
        screenPC.close();
        screenPC = null;
    }
    send("screen_share_stop", {});
}

// Called when SFU sends an offer for the screen share PC
export function handleScreenOffer(sdp: string) {
    // If we are the presenter:
    if (screenStream) {
        screenPC = new RTCPeerConnection({ iceServers: [...] });
        screenStream.getTracks().forEach(track => {
            screenPC!.addTrack(track, screenStream!);
        });
        screenPC.onicecandidate = (e) => {
            if (e.candidate) send("webrtc_screen_ice", { candidate: e.candidate.toJSON() });
        };
        screenPC.setRemoteDescription({ type: "offer", sdp })
            .then(() => screenPC!.createAnswer())
            .then(answer => screenPC!.setLocalDescription(answer))
            .then(() => send("webrtc_screen_answer", { sdp: screenPC!.localDescription!.sdp }));
        return;
    }

    // If we are a viewer:
    screenPC = new RTCPeerConnection({ iceServers: [...] });
    screenPC.ontrack = (event) => {
        // event.track.kind === "video" → display in UI
        // event.track.kind === "audio" → play through speakers
        setScreenShareStream(event.streams[0]);  // update store
    };
    screenPC.onicecandidate = (e) => {
        if (e.candidate) send("webrtc_screen_ice", { candidate: e.candidate.toJSON() });
    };
    screenPC.setRemoteDescription({ type: "offer", sdp })
        .then(() => screenPC!.createAnswer())
        .then(answer => screenPC!.setLocalDescription(answer))
        .then(() => send("webrtc_screen_answer", { sdp: screenPC!.localDescription!.sdp }));
}

export function handleScreenICE(candidate: RTCIceCandidateInit) {
    screenPC?.addIceCandidate(candidate).catch(() => {});
}
```

### Phase 5: Frontend — UI

**File: `client/src/stores/voice.ts`**

Add screen share state:

```typescript
const [screenShareUserId, setScreenShareUserId] = createSignal<string | null>(null);
const [screenShareStream, setScreenShareStream] = createSignal<MediaStream | null>(null);
export { screenShareUserId, setScreenShareUserId, screenShareStream, setScreenShareStream };
```

**File: `client/src/components/VoiceChannel/VoiceControls.tsx`**

Add a "Share Screen" button next to mute/deafen:
- Disabled if not in a voice channel
- Disabled if someone else is already sharing
- Toggles between start/stop
- Shows the sharer's name when active

**File: `client/src/components/VoiceChannel/ScreenShareView.tsx`** (new)

Video display component:
- Full-width `<video>` element bound to `screenShareStream()`
- Shows sharer's username
- "Stop Sharing" button if you are the presenter
- Click to toggle fullscreen
- Aspect ratio preserved, dark background

Place this component above the voice user grid in VoiceChannel.tsx when a screen share is active.

### Phase 6: Platform-Specific `getDisplayMedia` Behavior

#### Linux (WebKit2GTK — desktop app)

**`getDisplayMedia()` support:** WebKit2GTK supports screen capture via the **xdg-desktop-portal** API on systems running PipeWire. The portal shows a system dialog for the user to pick a screen/window.

**Requirements:**
- PipeWire running (standard on Ubuntu 22.04+)
- `xdg-desktop-portal` and `xdg-desktop-portal-gnome` (or `-gtk`) installed
- WebKit2GTK built with portal support (default on major distros)

**Video:** Works. The portal provides a PipeWire video stream.

**Audio:** `getDisplayMedia({ audio: true })` is **not supported** in WebKit2GTK. The portal protocol does support audio capture (since xdg-desktop-portal 0.4), but WebKit2GTK does not expose it to JavaScript.

**Audio workaround — PipeWire monitor source:**

1. When the user starts screen sharing, the Go server creates a PipeWire loopback that captures the target application's audio into a virtual monitor source:
   ```bash
   pw-loopback --capture-props='media.class=Audio/Sink' --playback-props='media.class=Audio/Source'
   ```
   This creates a virtual sink + source pair.

2. Use `wpctl` to move the target application's audio to the virtual sink.

3. The frontend calls `getUserMedia({ audio: { deviceId: virtualSourceId } })` to capture the audio from the virtual source and adds it to the screen share PC as a second track.

4. On stop, tear down the loopback.

**Complexity:** High. Requires tracking which application the user is sharing (not easily available from the portal), and the virtual source dance is fragile. **Recommendation:** Ship Linux screen share as video-only initially. Add audio capture as a follow-up if there's demand.

#### Windows (WebView2 / Edge Chromium)

**`getDisplayMedia()` support:** Full Chromium implementation. Works out of the box.

**Video:** Full support — screen, window, or tab capture.

**Audio:** Works when sharing a browser tab. For window/screen sharing, system audio capture is supported on Windows 10+ via the Windows Audio Session API loopback. `getDisplayMedia({ audio: true })` returns a system audio track when the user selects a screen or window (user must check the "Share audio" checkbox in the picker).

**No workaround needed.** The standard Web API works.

#### macOS (WKWebView)

**`getDisplayMedia()` support:** WKWebView supports screen capture starting with macOS 12.3+ and Safari 15.4+. The user must grant Screen Recording permission in System Settings > Privacy & Security.

**Video:** Works after the user grants Screen Recording permission. The OS shows a permission prompt on first use.

**Audio:** `getDisplayMedia({ audio: true })` is **not supported** in WKWebView/Safari. Apple does not provide a Web API for capturing system audio.

**Audio workaround — virtual audio driver:**

macOS has no userspace API for capturing system audio. Applications like Discord and OBS use a **virtual audio driver** (kernel extension or System Extension) to intercept the audio pipeline:

1. **ScreenCaptureKit (macOS 12.3+):** Apple's framework for screen + audio capture. Supports capturing audio from specific applications. However, this is a native Objective-C/Swift API — not exposed to JavaScript in WKWebView.

2. **Approach A — Native helper process:** Build a small Swift helper that uses ScreenCaptureKit to capture audio, writes it to a local loopback, and the WebView captures from the loopback via `getUserMedia`. Complex but avoids a kernel extension.

3. **Approach B — Virtual audio driver:** Ship a signed Audio Server Plugin (e.g., based on [BlackHole](https://github.com/ExistentialAudio/BlackHole)) that creates a virtual audio device. Route system audio through it. The WebView captures from the virtual device. Requires code signing and may require notarization.

4. **Approach C — Accept the limitation.** Ship macOS screen share as video-only, same as the initial Linux approach.

**Recommendation:** Start with video-only on macOS. If audio is needed later, Approach A (ScreenCaptureKit helper) is the most maintainable path, but requires a native macOS component outside the Go binary.

#### Browser Mode (Chrome/Firefox/Safari)

When running as a web app in a browser (not the desktop app):

- **Chrome/Edge:** Full `getDisplayMedia` with video + audio support.
- **Firefox:** `getDisplayMedia` with video. Audio capture is supported for tab sharing only (not window/screen).
- **Safari:** `getDisplayMedia` with video only. No audio capture.

No workarounds needed — the browser handles everything. The code is the same `getDisplayMedia({ video: true, audio: true })` call; the browser just ignores the `audio: true` if it's unsupported.

---

## Summary: Platform Audio Capture Matrix

| Platform | Video | Audio | Notes |
|----------|-------|-------|-------|
| **Linux desktop** (WebKit2GTK) | Yes (via portal) | No | Possible via PipeWire loopback hack |
| **Windows desktop** (WebView2) | Yes | Yes | Works natively |
| **macOS desktop** (WKWebView) | Yes (needs permission) | No | Possible via ScreenCaptureKit helper |
| **Chrome/Edge** (browser) | Yes | Yes | User must check "Share audio" |
| **Firefox** (browser) | Yes | Tab audio only | No screen/window audio |
| **Safari** (browser) | Yes | No | Apple limitation |

## Implementation Order

1. **SFU video codec + screen share room logic** — the backbone. Independent of platform.
2. **Signaling messages** — wire up WS ops for screen share lifecycle.
3. **Frontend: screen share WebRTC + UI** — `getDisplayMedia` call, video display, controls. Use `{ video: true, audio: true }` and let the platform decide what's available.
4. **Test on all platforms** — verify video works everywhere, audio works on Windows/Chrome.
5. **(Future) Linux audio** — PipeWire loopback integration in Go server.
6. **(Future) macOS audio** — ScreenCaptureKit native helper.

Steps 1–4 deliver a working screen share (video everywhere, audio where the platform supports it) without any platform-specific hacks. Steps 5–6 are optional follow-ups for audio on restrictive platforms.

## Estimated Scope

| Step | Files Changed | Effort |
|------|--------------|--------|
| SFU video support | `sfu/sfu.go`, `sfu/room.go`, `sfu/peer.go` | Medium |
| Signaling | `ws/handlers.go`, `ws/protocol.go` | Small |
| Frontend WebRTC | `lib/screenshare.ts` (new), `lib/webrtc.ts` | Medium |
| Frontend UI | `VoiceControls.tsx`, `VoiceChannel.tsx`, `ScreenShareView.tsx` (new), `stores/voice.ts` | Medium |
| Linux audio | `audio/screencapture_linux.go` (new) | Large |
| macOS audio | Native Swift helper (new binary) | Large |
