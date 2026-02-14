# Screen Sharing — Architecture

## Goal

Any user in a voice channel can share their screen. Any logged-in user can watch — they do **not** need to join voice. Screen share carries its own audio (game sounds, music, video playback). The presenter's microphone stays on the voice channel, separate from the screen share stream.

One active screen share per voice channel at a time.

---

## How It Works (User's Perspective)

**Presenter (in voice channel):**
1. Joins a voice channel (existing flow)
2. Clicks [SHARE] button in voice controls
3. OS picker appears — choose screen/window/tab
4. Other users see "Alice is sharing" indicator
5. Clicks [STOP] to end, or the OS "Stop sharing" button ends it

**Viewer (any logged-in user):**
1. Sees Alice's name in the "En Ligne" list has a screen icon: `🖥 Alice`
2. Clicks her name — video appears in the main content area
3. Hears screen audio (game sounds, etc.) without joining voice
4. Can optionally join voice to talk while watching
5. Clicks [✕] on the viewer or clicks the name again to stop watching

**Key:** Voice and screen share are independent streams. You can:
- Be in voice without watching the screen share
- Watch the screen share without being in voice
- Do both at the same time

---

## Architecture

### Separation of Concerns

```
Voice Channel                     Screen Share
─────────────                     ────────────
PeerConnection A (voice)          PeerConnection B (screen)
  └── Audio tracks (Opus)           ├── Video track (VP8)
  └── Existing SFU Room             └── Audio track (Opus, screen audio)
  └── Requires join_voice            └── Separate ScreenRoom in SFU
  └── Mutual: everyone sends         └── One-to-many: 1 sender, N receivers
      and receives audio                 Viewers are recv-only
```

Two completely separate PeerConnections. The voice PC uses the existing audio-only MediaEngine. The screen share PC uses a new MediaEngine with VP8 + Opus. They don't interfere with each other.

### Data Flow

```
Presenter                           SFU                          Viewer
   │                                 │                             │
   │  getDisplayMedia()              │                             │
   │  (video + screen audio)         │                             │
   │                                 │                             │
   │── screen_share_start ─────────> │                             │
   │                                 │── screen_share_started ───> │ (broadcast to ALL online)
   │                                 │                             │
   │<── webrtc_screen_offer ──────── │                             │
   │── webrtc_screen_answer ───────> │                             │
   │                                 │                             │
   │                                 │        Viewer clicks "watch"│
   │                                 │ <── screen_share_subscribe ─│
   │                                 │── webrtc_screen_offer ────> │
   │                                 │ <── webrtc_screen_answer ── │
   │                                 │                             │
   │═══ RTP video + audio ════════> │ ═══ forward to viewers ═══> │
   │                                 │                             │
   │── screen_share_stop ──────────> │                             │
   │                                 │── screen_share_stopped ───> │ (broadcast to ALL online)
```

### SFU Changes

#### New ScreenRoom (separate from voice Room)

```go
// server/sfu/screen_room.go

type ScreenRoom struct {
    ChannelID     string
    PresenterID   string
    presenterPC   *webrtc.PeerConnection
    videoTrack    *webrtc.TrackLocalStaticRTP   // forwarding track
    audioTrack    *webrtc.TrackLocalStaticRTP   // forwarding track (may be nil)
    viewers       map[string]*ScreenViewer      // userID → viewer
    mu            sync.RWMutex
}

type ScreenViewer struct {
    UserID string
    pc     *webrtc.PeerConnection
}
```

**Why a separate struct instead of extending Room?**
- Voice Room peers are mutual (everyone sends + receives audio). Screen share is one-to-many (one sender, N receivers).
- Viewers don't need to be in the voice Room at all.
- Lifecycle is independent — screen share can start/stop without disrupting voice connections.
- Different codec requirements (VP8 video vs audio-only).

#### Separate MediaEngine + API

```go
// server/sfu/sfu.go — add alongside existing voice API

func newScreenAPI(publicIP string) *webrtc.API {
    me := &webrtc.MediaEngine{}

    // VP8 for video
    me.RegisterCodec(webrtc.RTPCodecParameters{
        RTPCodecCapability: webrtc.RTPCodecCapability{
            MimeType:  webrtc.MimeTypeVP8,
            ClockRate: 90000,
        },
        PayloadType: 96,
    }, webrtc.RTPCodecTypeVideo)

    // Opus for screen audio (game sounds, music)
    me.RegisterCodec(webrtc.RTPCodecParameters{
        RTPCodecCapability: webrtc.RTPCodecCapability{
            MimeType:    webrtc.MimeTypeOpus,
            ClockRate:   48000,
            Channels:    2,
            SDPFmtpLine: "minptime=10;useinbandfec=1",
        },
        PayloadType: 111,
    }, webrtc.RTPCodecTypeAudio)

    // NACK + PLI for video reliability
    ir := &interceptor.Registry{}
    if err := webrtc.RegisterDefaultInterceptors(me, ir); err != nil {
        log.Fatal(err)
    }

    return webrtc.NewAPI(
        webrtc.WithMediaEngine(me),
        webrtc.WithInterceptorRegistry(ir),
    )
}
```

#### ScreenRoom Methods

```
StartShare(presenterID) error
    - Reject if already active
    - Create recv-only PeerConnection for presenter (receives their video+audio)
    - Send webrtc_screen_offer to presenter
    - On presenter's OnTrack: create forwarding TrackLocalStaticRTP
    - Store in sfu.screenRooms[channelID]

StopShare()
    - Close presenter PC
    - Close all viewer PCs
    - Remove from sfu.screenRooms
    - Broadcast screen_share_stopped

AddViewer(userID) error
    - Create send-only PeerConnection for viewer
    - Add forwarding tracks (video + audio) to viewer PC
    - Send webrtc_screen_offer to viewer

RemoveViewer(userID)
    - Close viewer PC, remove from map

HandleScreenAnswer(userID, sdp)
    - Route to presenter or viewer PC based on userID

HandleScreenICE(userID, candidate)
    - Route to presenter or viewer PC based on userID
```

#### SFU Struct Additions

```go
type SFU struct {
    // existing
    rooms    map[string]*Room
    api      *webrtc.API   // voice (Opus-only)

    // new
    screenRooms map[string]*ScreenRoom
    screenAPI   *webrtc.API  // screen share (VP8 + Opus)
}
```

### WebSocket Protocol

#### Client → Server

| Op | Payload | Who | Description |
|----|---------|-----|-------------|
| `screen_share_start` | `{}` | Presenter (must be in voice) | Start sharing screen |
| `screen_share_stop` | `{}` | Presenter | Stop sharing |
| `screen_share_subscribe` | `{ channel_id }` | Any logged-in user | Start watching |
| `screen_share_unsubscribe` | `{ channel_id }` | Viewer | Stop watching |
| `webrtc_screen_answer` | `{ sdp }` | Presenter or Viewer | SDP answer for screen PC |
| `webrtc_screen_ice` | `{ candidate }` | Presenter or Viewer | ICE candidate for screen PC |

#### Server → Client

| Op | Payload | To | Description |
|----|---------|-----|-------------|
| `screen_share_started` | `{ user_id, channel_id }` | All online | Someone started sharing |
| `screen_share_stopped` | `{ user_id, channel_id }` | All online | Sharing ended |
| `webrtc_screen_offer` | `{ sdp }` | Presenter or Viewer | SDP offer for screen PC |
| `webrtc_screen_ice` | `{ candidate }` | Presenter or Viewer | ICE candidate for screen PC |
| `screen_share_error` | `{ error }` | Requester | Rejection message |

#### Ready Payload Addition

Include active screen shares in the `ready` response so clients connecting mid-share know what's happening:

```go
type ReadyData struct {
    // existing fields...
    ScreenShares []ScreenShareState `json:"screen_shares"`
}

type ScreenShareState struct {
    UserID    string `json:"user_id"`
    ChannelID string `json:"channel_id"`
}
```

### Voice State Addition

Add `screen_sharing` to `VoiceStatePayload` so the sidebar can show who is sharing:

```go
type VoiceStatePayload struct {
    // existing fields...
    ScreenSharing bool `json:"screen_sharing"`
}
```

---

## Frontend

### New File: `client/src/lib/screenshare.ts`

Manages the screen share PeerConnection (separate from voice PC in webrtc.ts).

```typescript
let screenPC: RTCPeerConnection | null = null;
let screenStream: MediaStream | null = null;  // presenter only
let isPresenting = false;

export async function startScreenShare() {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { max: 30 } },
        audio: true,  // screen audio — ignored if platform doesn't support it
    });

    // Handle user clicking "Stop sharing" in OS UI
    screenStream.getVideoTracks()[0].onended = () => stopScreenShare();

    isPresenting = true;
    send("screen_share_start", {});
}

export function stopScreenShare() {
    screenStream?.getTracks().forEach(t => t.stop());
    screenStream = null;
    screenPC?.close();
    screenPC = null;
    isPresenting = false;
    send("screen_share_stop", {});
    setScreenShareStream(null);
    setScreenShareUserId(null);
}

export function subscribeScreenShare(channelId: string) {
    send("screen_share_subscribe", { channel_id: channelId });
}

export function unsubscribeScreenShare(channelId: string) {
    screenPC?.close();
    screenPC = null;
    send("screen_share_unsubscribe", { channel_id: channelId });
    setScreenShareStream(null);
}

// Called when SFU sends webrtc_screen_offer
export async function handleScreenOffer(sdp: string) {
    screenPC = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    if (isPresenting && screenStream) {
        // Presenter: add local screen tracks to PC
        screenStream.getTracks().forEach(track => {
            screenPC!.addTrack(track, screenStream!);
        });
    } else {
        // Viewer: receive tracks
        screenPC.ontrack = (event) => {
            setScreenShareStream(event.streams[0] || new MediaStream([event.track]));
        };
    }

    screenPC.onicecandidate = (e) => {
        if (e.candidate) {
            send("webrtc_screen_ice", { candidate: e.candidate.toJSON() });
        }
    };

    await screenPC.setRemoteDescription({ type: "offer", sdp });
    const answer = await screenPC.createAnswer();
    await screenPC.setLocalDescription(answer);
    send("webrtc_screen_answer", { sdp: answer.sdp! });
}

export function handleScreenICE(candidate: RTCIceCandidateInit) {
    screenPC?.addIceCandidate(candidate).catch(() => {});
}
```

### Store: `client/src/stores/voice.ts` additions

```typescript
// Who is sharing and on which channel
const [screenShareUserId, setScreenShareUserId] = createSignal<string | null>(null);
const [screenShareChannelId, setScreenShareChannelId] = createSignal<string | null>(null);
// The incoming video+audio stream for viewers
const [screenShareStream, setScreenShareStream] = createSignal<MediaStream | null>(null);
```

### Event Handler: `client/src/lib/events.ts` additions

```typescript
case "screen_share_started":
    setScreenShareUserId(msg.d.user_id);
    setScreenShareChannelId(msg.d.channel_id);
    break;

case "screen_share_stopped":
    setScreenShareUserId(null);
    setScreenShareChannelId(null);
    setScreenShareStream(null);
    // Close viewer PC if watching
    unsubscribeScreenShare(msg.d.channel_id);
    break;

case "webrtc_screen_offer":
    handleScreenOffer(msg.d.sdp);
    break;

case "webrtc_screen_ice":
    handleScreenICE(msg.d.candidate);
    break;

case "screen_share_error":
    console.error("[screen] Share rejected:", msg.d.error);
    break;
```

### UI

#### Discovery: The Online Users List

No new UI panels needed for discovering who's sharing. The existing **"En Ligne"** list in the sidebar already shows every online user. When someone starts sharing, their entry gets a screen icon and becomes clickable:

```
EN LIGNE — 4
  ● Kalli (you)
  🖥 Alice              ← sharing, clickable
  ● Bob
  ● Charlie
```

- `🖥` icon appears next to users who are currently sharing
- Clicking a sharing user's name opens the viewer in the main content area
- Clicking again (or clicking [✕] on the viewer) stops watching
- The icon also appears next to their name under the voice channel list:

```
CANAUX VOCAUX
  ○ General
    ● Alice 🖥
    ● Bob
```

This keeps discovery natural — you see who's online, you see who's sharing, you click to watch. No new navigation or modes.

#### Starting a Share: Voice Controls

Add a [SHARE] button in `VoiceControls.tsx` next to mute/deafen/quit:
- Only visible when in a voice channel
- Disabled if someone else is already sharing in the same channel
- Toggles between `[SHARE]` and `[STOP]`

```
General · 42ms · 48kbps · opus
[MIC] [SPK] [SHARE] [QUIT]
```

#### Watching: Main Content Area

When the user clicks a sharing user's name, the main content area shows the screen share viewer. This replaces whatever was in the main panel (text channel, voice channel, or welcome screen):

```
┌──────────────────────────────────────────────┐
│  🖥 Alice is sharing                   [✕]   │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│              <video> element                 │
│           (click for fullscreen)             │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│  🔇 unmute screen audio                     │
└──────────────────────────────────────────────┘
```

- `<video>` element bound to `screenShareStream()`
- Click video to toggle fullscreen (`element.requestFullscreen()`)
- [✕] closes viewer, unsubscribes from stream, returns to previous view
- If the viewer is the presenter: shows `[STOP SHARING]` instead of [✕]
- Aspect ratio preserved, letterboxed on dark background
- **Autoplay policy**: video starts muted (browsers block unmuted autoplay). A "🔇 unmute screen audio" bar at the bottom lets the user enable audio with one click. Once clicked, it stays unmuted for the session.

#### State in App.tsx

The main content area routing (currently: no channel selected → welcome, text channel → TextChannel, voice channel → VoiceChannel) gets one more branch:

```typescript
// In the channel content switcher:
const watchingUser = watchingScreenShareUserId();
if (watchingUser) {
    return <ScreenShareView userId={watchingUser} />;
}
// ... existing channel routing
```

A new signal `watchingScreenShareUserId` tracks who the user is currently watching. Set by clicking a sharing user's name in the sidebar, cleared by clicking [✕] or when the share ends.

---

## Desktop (Tauri) Considerations

### Browser Path (WebView)

The existing browser `getDisplayMedia()` API works in WebView on most platforms:

| Platform | Video | Screen Audio | Notes |
|----------|-------|-------------|-------|
| **Linux** (WebKit2GTK) | Yes | No | PipeWire portal for screen picker |
| **Windows** (WebView2) | Yes | Yes | Full Chromium support |
| **macOS** (WKWebView) | Yes | No | Needs Screen Recording permission |
| **Chrome/Edge** | Yes | Yes | User checks "Share audio" |
| **Firefox** | Yes | Tab only | No screen/window audio |
| **Safari** | Yes | No | Apple limitation |

### Native Rust Path (future)

For Linux where WebKit2GTK may have issues, screen capture could be done natively via PipeWire in Rust (similar to how voice uses native Opus/cpal). This is a significant effort and should only be pursued if the WebView path proves unreliable.

**Recommendation:** Use the WebView `getDisplayMedia()` path for all platforms initially. It works for video everywhere. Audio works on Windows and Chrome. Tackle native capture only if needed.

---

## Server-Side Validation

The server enforces these rules:

1. **Must be in voice to share** — `screen_share_start` rejected if user has no active voice state
2. **One share per channel** — rejected if another user is already sharing in that channel
3. **Share stops on voice leave** — if the presenter leaves voice, their screen share is automatically stopped
4. **Share stops on disconnect** — if the presenter's WebSocket drops, screen share is cleaned up
5. **Any logged-in user can subscribe** — no need to be in the voice channel
6. **Viewer cleanup on disconnect** — viewer PCs closed when user goes offline

---

## Renegotiation

The screen share PeerConnections are simpler than voice:

- **Presenter PC**: Created once with recv-only video + audio transceivers. No renegotiation needed — the presenter sends tracks, the SFU receives them.
- **Viewer PCs**: Created once with send-only video + audio tracks from the forwarding TrackLocalStaticRTP. No renegotiation needed — the SFU sends, the viewer receives.

The existing voice renegotiation mechanism (`needsRenegotiation` flag) is not needed for screen share because tracks don't change mid-session. If the presenter stops sharing, the entire ScreenRoom is torn down rather than renegotiated.

---

## Implementation Order

### Phase 1: SFU Screen Share Room
- `server/sfu/screen_room.go` — ScreenRoom struct, presenter/viewer PeerConnections
- `server/sfu/sfu.go` — screenAPI, screenRooms map, GetScreenRoom/StartScreen/StopScreen methods
- Video codec registration (VP8 + Opus)
- PLI interceptor for keyframe requests

### Phase 2: Signaling
- `server/ws/handlers.go` — 6 new WS op handlers
- `server/ws/protocol.go` — ScreenShareState, new payloads
- Add screen_shares to ready payload
- Add screen_sharing to VoiceStatePayload
- Auto-stop on voice leave / disconnect

### Phase 3: Frontend Core
- `client/src/lib/screenshare.ts` — screen PC management, getDisplayMedia
- `client/src/stores/voice.ts` — screen share signals
- `client/src/lib/events.ts` — screen share event handlers

### Phase 4: Frontend UI
- VoiceControls.tsx — [SHARE] / [STOP SHARE] button
- Sidebar — "X is sharing" indicator
- ScreenShareView.tsx — video display, fullscreen, close
- VoiceChannel.tsx — mount ScreenShareView when active

### Phase 5: Polish
- Autoplay policy handling (muted autoplay + unmute button)
- Resolution/framerate constraints (720p default, 1080p option)
- Bandwidth estimation and adaptive quality
- Floating viewer panel (Option B)

---

## Files Changed / Created

| File | Action | Description |
|------|--------|-------------|
| `server/sfu/sfu.go` | Modify | Add screenAPI, screenRooms map |
| `server/sfu/screen_room.go` | **Create** | ScreenRoom, ScreenViewer, presenter/viewer PC management |
| `server/ws/handlers.go` | Modify | Add 6 screen share op handlers |
| `server/ws/protocol.go` | Modify | ScreenShareState, new payloads, voice state addition |
| `server/ws/hub.go` | Modify | Cleanup screen share on disconnect |
| `client/src/lib/screenshare.ts` | **Create** | Screen share WebRTC + getDisplayMedia |
| `client/src/lib/events.ts` | Modify | Screen share event dispatch |
| `client/src/stores/voice.ts` | Modify | Screen share signals |
| `client/src/components/VoiceChannel/VoiceControls.tsx` | Modify | [SHARE] button |
| `client/src/components/VoiceChannel/ScreenShareView.tsx` | **Create** | Video viewer component |
| `client/src/components/VoiceChannel/VoiceChannel.tsx` | Modify | Mount ScreenShareView |
| `client/src/components/Sidebar/Sidebar.tsx` | Modify | "X is sharing" indicator |
