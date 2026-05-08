# Feature: Live Audio Share in Voice Channels

## Intent

Allow a user in a voice channel to broadcast a second audio source — alongside their microphone — so that other channel members hear both at once. Typical use cases:

- A user DJs from their local Spotify / browser tab while talking over the music with friends.
- A user shares the audio of a game they are playing while voice-chatting.
- A user shares a podcast or interview clip without leaving the voice channel.

The mic and the shared audio are independent streams: the user can mute the mic without stopping the share, stop the share without muting the mic, and continue speaking while the share plays.

## Current Behavior

A user in a voice channel publishes exactly one Opus track — their microphone — over their WebRTC peer connection to the SFU. There is no mechanism to publish a second audio source. To share music, users currently route their system audio into their mic (with VB-CABLE etc.), which mixes the two and prevents independent control.

## New Behavior

### Sources

A "source" is a second audio stream a user publishes alongside their mic. Each source has:

- `source_id` — server-assigned UUID, scoped to the user's current voice session
- `label` — short human-readable string ("Spotify", "Tab: YouTube", "System audio")
- Owner user

A user has at most **one** active share source per voice session in v1. Starting a second share replaces the first.

### Capture surfaces

The capture mechanism is platform-dependent. Three are supported in v1:

| Surface | Capture method | Label source |
|---|---|---|
| Web (any OS, Chromium) | `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })` — user picks a tab/window/screen and ticks the audio box; video track is discarded | Label = display surface label, e.g. "Tab: Spotify" |
| Windows desktop | WASAPI process loopback (`ActivateAudioInterfaceAsync` with `PROCESS_LOOPBACK`) targeting a chosen process | Label = process executable name, e.g. "spotify.exe" |
| Linux desktop (existing) | PipeWire portal `SelectSources` with `audio: true` alongside screen share — already plumbed in the screen capture pipeline | Label = portal-reported source name |

macOS support is **not** in scope for v1. macOS lacks a public per-app audio API; system-wide audio via ScreenCaptureKit is a v2 candidate.

### WebSocket Protocol Additions

**Client → Server**

```
voice_share_audio_start { label: string }
```
- Caller must already be in a voice channel
- Server assigns a `source_id` and broadcasts `voice_audio_source_added`
- If the caller already has an active share, server first broadcasts `voice_audio_source_removed` for the old one

```
voice_share_audio_stop {}
```
- No-op if caller has no active share
- Broadcasts `voice_audio_source_removed`

The actual audio is published as a second WebRTC track on the existing peer connection. The standard `webrtc_offer` / `webrtc_answer` renegotiation flow carries the new track.

**Server → Client**

```
voice_audio_source_added { user_id, source_id, label }
voice_audio_source_removed { user_id, source_id }
```
- Sent to every other user in the same voice channel
- Receiving clients use this to render an indicator ("🎵 Spotify — alice") and to know which inbound track is the share vs. the mic

### SFU changes

Per-peer outbound and inbound track maps must change from one-track-per-peer to a list keyed by track ID. On `OnTrack`, the SFU appends to the publisher's list and forwards the new track to every other peer in the same room as a separate inbound track.

The existing `needsRenegotiation` flag (already in place for join/leave races) is reused for add-track and remove-track events.

### Receiving and playback

Receivers play the share track through the same audio output path as voice — no separate device picker in v1. Per-source volume is **not** exposed in v1; both tracks mix at unity. Future work: per-source volume slider in the user list entry.

### Echo / feedback

A user sharing system audio while listening through speakers will have their mic capture the music, sending it back to the room a second time and creating a comb-filter / echo. WebRTC's built-in AEC cannot remove this because it does not have the loopback signal as a reference.

The product answer is: **the user must wear headphones**. The UI surfaces a one-time hint when the user starts a share from a non-headset output device, but there is no programmatic enforcement.

### UI

A new "Share audio" button in `VoiceControls` next to mute/deafen. Behavior depends on surface:

- **Web:** Opens the standard `getDisplayMedia` picker. If the user does not tick the audio checkbox, the share is rejected with a hint.
- **Windows desktop:** Opens a process picker dialog populated by a new Tauri IPC command `list_audio_processes()`. The user selects a process; capture starts immediately.
- **Linux desktop:** Reuses the existing PipeWire portal flow, but with audio-only mode (no video track produced).

While sharing, the button toggles to "Stop sharing." Each remote user with an active share appears in the voice user list with a 🎵 indicator and the source label on hover.

### Auto-stop conditions

A share ends automatically when:

1. The user leaves the voice channel
2. The user disconnects (WS or PC dropped)
3. The browser-side capture stream emits `ended` (user clicked the browser's "Stop sharing" bar)
4. The desktop-side capture pipe errors or the target process exits
5. The user joins a different voice channel

In all cases, server broadcasts `voice_audio_source_removed`.

## Files

| File | Purpose |
|------|---------|
| `server/sfu/peer.go`, `server/sfu/room.go` | Multi-track per peer; per-track forwarding |
| `server/ws/handlers.go` | New ops: `voice_share_audio_start`, `voice_share_audio_stop` |
| `server/ws/protocol.go` | New event constants and payload types |
| `server/ws/hub.go` | Track source state on `Client`; cleanup on disconnect / channel switch |
| `client/src/lib/audioShare.ts` | New: web `getDisplayMedia` audio extraction; track add/remove on existing PC |
| `client/src/lib/webrtc.ts` | Allow second outbound track; map inbound tracks by source label |
| `client/src/stores/voice.ts` | New per-user `audioSources: { source_id, label }[]` |
| `client/src/components/VoiceChannel/VoiceControls.tsx` | Share / Stop button |
| `client/src/components/VoiceChannel/VoiceUser.tsx` | 🎵 indicator + source label tooltip |
| `client/src/lib/events.ts` | Dispatch `voice_audio_source_added` / `_removed` to store |
| `desktop/src-tauri/src/voice/audio_capture.rs` | New WASAPI process-loopback capture (Windows) |
| `desktop/src-tauri/src/voice/mod.rs` | IPC commands: `list_audio_processes`, `start_app_loopback`, `stop_app_loopback` |
| `desktop/src-tauri/Cargo.toml` | Add `windows` crate (or `wasapi` crate) for Windows target |

## Database

None. Share state is ephemeral, lives on the `Client` struct in the hub, and is cleared on disconnect.

## Design Decisions

1. **Two RTP tracks, not server-side mixing.** SFUs forward; they don't mix. Mixing on the server destroys per-source volume control and adds CPU cost. Two tracks costs negligibly more bandwidth and gives the receiver full control.

2. **One share per user in v1.** Multiple simultaneous shares per user (mic + Spotify + game) would require a richer source taxonomy in the UI and protocol. Single-share covers ~95% of intended use; revisit if users ask.

3. **No persistence.** Share state is session-scoped. Server restart drops all shares with the rest of voice state.

4. **No per-source volume in v1.** Wires up correctly later (the SFU multi-track work is the prerequisite); skipping the UI control reduces v1 surface area.

5. **Headphones are documented, not enforced.** Detecting "user is on speakers" reliably across OSes is hard and high-false-positive. A one-time hint plus documentation is the pragmatic answer.

6. **Web: video track discarded.** Chrome requires `video: true` in `getDisplayMedia` for audio capture. We accept the constraint, immediately stop the video track on receipt, and only publish the audio track. The user briefly sees a "this tab is being shared" indicator in their browser but no video flows.

7. **Windows desktop is the only "true per-app" target.** Web is per-tab; Linux is per-portal-source; Windows can target a specific process. The protocol uses an opaque `label` string so the UI does not need to distinguish.

8. **macOS deferred.** No public per-app audio API. ScreenCaptureKit (macOS 13+) can capture system audio but not per-app. Add as a v2 with explicit "shares all system audio" semantics.

## Out of Scope (v2 candidates)

- macOS audio share via ScreenCaptureKit
- Per-source receiver volume sliders
- Multiple concurrent shares per user
- Recording / archival of shared audio
- Bitrate / codec selection per source (everything is Opus 48 kHz stereo)
- Sharing audio with the synchronized media player applet (those are different features and should stay independent)
