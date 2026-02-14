# VoiceChat — Minimal Discord Alternative

## Specification Document

### Project Overview

Build a minimal, self-hostable Discord alternative focused on voice chat and text messaging. The application must run as a single binary on any machine, be accessible via browser, and deliver near-zero latency audio. Think "Discord stripped to its core" — persistent voice channels, text chat with replies/reactions/mentions/images, and per-user volume control.

### Design Principles

- **Single binary deployment** — no Docker, no database server, no runtime dependencies
- **Browser-first** — full functionality via any modern browser; optional Tauri desktop wrapper
- **Near-zero audio latency** — SFU architecture with Opus codec, no transcoding
- **Minimal but complete** — every feature listed below must work, but nothing beyond them

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Server language | **Go** | Single binary output, excellent concurrency, mature WebRTC ecosystem |
| WebRTC / SFU | **Pion** (pure Go) | No C/C++ deps, compiles into same binary, battle-tested |
| Real-time transport | **WebSocket** (nhooyr.io/websocket or gorilla) | Chat, presence, signaling over single persistent connection |
| REST API | **Go net/http** (stdlib) | Image upload, channel CRUD, message history pagination, auth |
| Database | **SQLite** (WAL mode) | Zero-config, embedded, handles thousands of writes/sec |
| File storage | **Local filesystem** | Hash-based directory structure for uploaded images |
| Frontend framework | **SolidJS** | ~7KB bundle, no virtual DOM, React-like DX |
| Desktop wrapper | **Tauri** (optional) | ~3MB binary vs Electron's ~150MB, uses system webview |
| Audio codec | **Opus** | Browser-native via WebRTC, 20ms frames, DTX support |

### Go Module Dependencies (Approximate)

```
github.com/pion/webrtc/v4        # WebRTC SFU
nhooyr.io/websocket              # WebSocket server
modernc.org/sqlite               # Pure Go SQLite (no CGO required)
github.com/google/uuid           # ID generation
golang.org/x/image               # Thumbnail generation
```

### Frontend Dependencies

```json
{
  "dependencies": {
    "solid-js": "^1.8",
    "@solidjs/router": "^0.14"
  },
  "devDependencies": {
    "vite": "^5",
    "vite-plugin-solid": "^2",
    "typescript": "^5"
  }
}
```

---

## Directory Structure

```
voicechat/
├── server/
│   ├── main.go                  # Entry point — wires HTTP, WS, SFU, serves embedded SPA
│   ├── go.mod
│   ├── go.sum
│   ├── config/
│   │   └── config.go            # CLI flags / env vars (port, data dir, max upload size)
│   ├── db/
│   │   ├── db.go                # SQLite connection, migrations, WAL mode setup
│   │   ├── migrations.go        # Schema creation / versioned migrations
│   │   ├── channels.go          # Channel CRUD queries
│   │   ├── messages.go          # Message queries (create, list with pagination, search)
│   │   ├── reactions.go         # Reaction queries
│   │   ├── attachments.go       # Attachment metadata queries
│   │   ├── users.go             # User queries
│   │   └── mentions.go          # Mention queries
│   ├── ws/
│   │   ├── hub.go               # WebSocket hub — manages all connected clients, broadcasts
│   │   ├── client.go            # Single WS client — read/write pumps, auth state
│   │   ├── handlers.go          # Dispatch incoming ops to handler functions
│   │   └── protocol.go          # Message types, op codes, serialization
│   ├── sfu/
│   │   ├── sfu.go               # SFU manager — creates/destroys rooms per voice channel
│   │   ├── room.go              # Single voice channel room — manages peer connections
│   │   ├── peer.go              # Single peer in a room — tracks, mute state
│   │   └── signal.go            # WebRTC signaling helpers (offer/answer/ICE via WS)
│   ├── api/
│   │   ├── router.go            # HTTP route registration
│   │   ├── auth.go              # Simple auth (username + token, no OAuth complexity)
│   │   ├── channels.go          # REST: channel CRUD
│   │   ├── messages.go          # REST: message history with cursor pagination
│   │   └── upload.go            # REST: image upload, validation, thumbnail generation
│   ├── storage/
│   │   └── files.go             # Filesystem image storage, hash-based paths, thumbnail gen
│   └── static/
│       └── (embedded SPA via go:embed)
├── client/
│   ├── index.html
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── package.json
│   ├── src/
│   │   ├── index.tsx            # Mount app
│   │   ├── App.tsx              # Root layout — sidebar + main content area
│   │   ├── stores/
│   │   │   ├── auth.ts          # Auth state (username, token)
│   │   │   ├── channels.ts      # Channel list state
│   │   │   ├── messages.ts      # Messages per channel, pagination state
│   │   │   ├── voice.ts         # Voice state (who's in which channel, mute states)
│   │   │   └── users.ts         # Online users, presence
│   │   ├── lib/
│   │   │   ├── ws.ts            # WebSocket client — connect, reconnect, dispatch
│   │   │   ├── webrtc.ts        # Voice connection manager — join/leave, handle tracks
│   │   │   ├── audio.ts         # Per-user audio chain (GainNode, mute, volume, speaking)
│   │   │   ├── devices.ts       # Mic/speaker enumeration and selection
│   │   │   └── upload.ts        # Image upload (drag-drop + click), progress tracking
│   │   ├── components/
│   │   │   ├── Sidebar/
│   │   │   │   ├── Sidebar.tsx          # Channel list sidebar
│   │   │   │   ├── ChannelItem.tsx      # Single channel entry (voice or text)
│   │   │   │   └── CreateChannel.tsx    # Create channel modal/form
│   │   │   ├── VoiceChannel/
│   │   │   │   ├── VoiceChannel.tsx     # Voice channel view — user list, controls
│   │   │   │   ├── VoiceUser.tsx        # Single user in voice — avatar, mute icons, speaking indicator
│   │   │   │   ├── VoiceControls.tsx    # Bottom bar: mute, deafen, disconnect, device select
│   │   │   │   └── UserVolumePopup.tsx  # Right-click menu: volume slider, local mute
│   │   │   ├── TextChannel/
│   │   │   │   ├── TextChannel.tsx      # Text channel view — message list + input
│   │   │   │   ├── MessageList.tsx      # Scrollable message list with infinite scroll up
│   │   │   │   ├── Message.tsx          # Single message — content, attachments, reactions, reply
│   │   │   │   ├── ReplyPreview.tsx     # Inline reply preview above a message
│   │   │   │   ├── ReactionBar.tsx      # Reaction display + add reaction button
│   │   │   │   ├── MessageInput.tsx     # Text input with + button, @mention autocomplete
│   │   │   │   └── MentionAutocomplete.tsx  # @mention dropdown
│   │   │   ├── Auth/
│   │   │   │   └── Login.tsx            # Simple username entry (and optional password)
│   │   │   └── common/
│   │   │       ├── Avatar.tsx
│   │   │       ├── Modal.tsx
│   │   │       ├── EmojiPicker.tsx      # Simple emoji picker for reactions
│   │   │       └── ImagePreview.tsx     # Lightbox for clicking on attached images
│   │   └── styles/
│   │       └── global.css               # Minimal CSS — dark theme, CSS variables
│   └── dist/                            # Build output → embedded into Go binary
└── README.md
```

---

## Database Schema (SQLite)

Run these migrations on first startup. Use a `schema_version` table to track migration state.

```sql
-- Enable WAL mode for concurrent reads during writes
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Schema versioning
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

-- Users
CREATE TABLE users (
    id          TEXT PRIMARY KEY,              -- UUID
    username    TEXT NOT NULL UNIQUE,
    password_hash TEXT,                        -- bcrypt hash, nullable for passwordless mode
    is_admin    BOOLEAN NOT NULL DEFAULT FALSE,-- First registered user is auto-promoted
    avatar_path TEXT,
    created_at  DATETIME DEFAULT (datetime('now'))
);

-- Auth tokens
CREATE TABLE tokens (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  DATETIME DEFAULT (datetime('now')),
    expires_at  DATETIME
);
CREATE INDEX idx_tokens_user ON tokens(user_id);
CREATE INDEX idx_tokens_expires ON tokens(expires_at);

-- Channels (persistent)
CREATE TABLE channels (
    id          TEXT PRIMARY KEY,              -- UUID
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK(type IN ('voice', 'text')),
    position    INTEGER NOT NULL,              -- For ordering in sidebar; set to MAX(position)+1 on insert
    created_at  DATETIME DEFAULT (datetime('now'))
);

-- Messages
CREATE TABLE messages (
    id          TEXT PRIMARY KEY,              -- UUID
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id   TEXT NOT NULL REFERENCES users(id),
    content     TEXT CHECK(content IS NULL OR length(content) <= 4000), -- NULL if image-only, max 4000 chars
    reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    created_at  DATETIME DEFAULT (datetime('now')),
    edited_at   DATETIME
);
CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);

-- Reactions
CREATE TABLE reactions (
    message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,                 -- Unicode emoji character(s)
    created_at  DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX idx_reactions_message ON reactions(message_id);

-- Attachments (images)
-- message_id is NULL between upload and message send; a periodic cleanup job
-- deletes unlinked attachments older than 1 hour (see Orphaned Attachment Cleanup).
CREATE TABLE attachments (
    id          TEXT PRIMARY KEY,              -- UUID
    message_id  TEXT REFERENCES messages(id) ON DELETE CASCADE, -- NULL until linked to a message
    filename    TEXT NOT NULL,                 -- Original filename
    path        TEXT NOT NULL,                 -- Storage path relative to data dir
    thumb_path  TEXT,                          -- Thumbnail path
    size_bytes  INTEGER NOT NULL,
    mime_type   TEXT NOT NULL,
    width       INTEGER,                       -- Image dimensions (extracted on upload)
    height      INTEGER,
    created_at  DATETIME DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_message ON attachments(message_id);
CREATE INDEX idx_attachments_orphan ON attachments(message_id, created_at) WHERE message_id IS NULL;

-- Mentions (extracted from message content on insert)
CREATE TABLE mentions (
    message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX idx_mentions_user ON mentions(user_id);

-- Channel read state (for unread indicators)
CREATE TABLE channel_reads (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
    updated_at  DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, channel_id)
);
```

---

## WebSocket Protocol

All real-time communication uses a single WebSocket connection per client at `ws(s)://<host>/ws`.

**Authentication:** The client connects without credentials in the URL. Immediately after the connection opens, the client must send an `authenticate` message. The server waits for this message before processing any other operations. If no valid `authenticate` is received within 5 seconds, the server closes the connection. This avoids leaking tokens in URLs (server logs, proxy logs, browser history).

```typescript
// First message after WS connect — must be sent before any other op
{ op: "authenticate", d: { token: string } }
```

### Message Format

```typescript
interface WSMessage {
    op: string;       // Operation name
    d: any;           // Payload data
}
```

### Client → Server Operations

```typescript
// --- Chat ---

// Send a text message (with optional reply and pre-uploaded attachment IDs)
{ op: "send_message", d: {
    channel_id: string,
    content: string | null,           // Text content (null if image-only)
    reply_to_id: string | null,       // Message ID being replied to
    attachment_ids: string[]           // IDs returned from upload endpoint
}}

// Edit a message (only your own)
{ op: "edit_message", d: {
    message_id: string,
    content: string
}}

// Delete a message (only your own, or admin)
{ op: "delete_message", d: {
    message_id: string
}}

// Add / remove reaction
{ op: "add_reaction", d: { message_id: string, emoji: string }}
{ op: "remove_reaction", d: { message_id: string, emoji: string }}

// Typing indicator
{ op: "typing_start", d: { channel_id: string }}

// --- Voice ---

// Join a voice channel (leave current one implicitly)
{ op: "join_voice", d: { channel_id: string }}

// Leave voice channel
{ op: "leave_voice", d: {} }

// WebRTC signaling (offer, answer, ICE candidates)
{ op: "webrtc_offer", d: { sdp: string }}
{ op: "webrtc_answer", d: { sdp: string }}
{ op: "webrtc_ice", d: { candidate: RTCIceCandidateInit }}

// Voice state changes
{ op: "voice_self_mute", d: { muted: boolean }}
{ op: "voice_self_deafen", d: { deafened: boolean }}
{ op: "voice_speaking", d: { speaking: boolean }}

// Server-mute another user (requires admin)
{ op: "voice_server_mute", d: { user_id: string, muted: boolean }}

// --- Channels ---

// Create a channel
{ op: "create_channel", d: { name: string, type: "voice" | "text" }}

// Delete a channel
{ op: "delete_channel", d: { channel_id: string }}

// Reorder channels
{ op: "reorder_channels", d: { channel_ids: string[] }}  // New ordering
```

### Server → Client Operations

```typescript
// --- Connection ---

// Sent immediately after WS auth succeeds
{ op: "ready", d: {
    user: User,
    channels: Channel[],
    voice_states: VoiceState[],       // Who is in which voice channel right now
    online_users: User[]
}}

// --- Chat events ---

{ op: "message_create", d: {
    id: string,
    channel_id: string,
    author: User,
    content: string | null,
    reply_to: Message | null,         // Populated reply context (author + content preview)
    attachments: Attachment[],
    mentions: string[],               // User IDs mentioned
    created_at: string
}}

{ op: "message_update", d: {
    id: string,
    channel_id: string,
    content: string,
    edited_at: string
}}

{ op: "message_delete", d: {
    id: string,
    channel_id: string
}}

{ op: "reaction_add", d: {
    message_id: string,
    user_id: string,
    emoji: string
}}

{ op: "reaction_remove", d: {
    message_id: string,
    user_id: string,
    emoji: string
}}

{ op: "typing_start", d: {
    channel_id: string,
    user_id: string
}}

// --- Voice events ---

{ op: "voice_state_update", d: {
    user_id: string,
    channel_id: string | null,        // null = left voice
    self_mute: boolean,
    self_deafen: boolean,
    server_mute: boolean,
    speaking: boolean
}}

// WebRTC signaling from server/SFU
{ op: "webrtc_offer", d: { sdp: string }}
{ op: "webrtc_answer", d: { sdp: string }}
{ op: "webrtc_ice", d: { candidate: RTCIceCandidateInit }}

// --- Presence ---

{ op: "user_online", d: { user: User }}
{ op: "user_offline", d: { user_id: string }}

// --- Channel events ---

{ op: "channel_create", d: Channel }
{ op: "channel_delete", d: { channel_id: string }}
{ op: "channel_reorder", d: { channel_ids: string[] }}
```

### Type Definitions

```typescript
interface User {
    id: string;
    username: string;
    avatar_url: string | null;
}

interface Channel {
    id: string;
    name: string;
    type: "voice" | "text";
    position: number;
}

interface Message {
    id: string;
    channel_id: string;
    author: User;
    content: string | null;
    reply_to: { id: string; author: User; content: string } | null;
    attachments: Attachment[];
    reactions: ReactionGroup[];
    mentions: string[];
    created_at: string;
    edited_at: string | null;
}

interface Attachment {
    id: string;
    filename: string;
    url: string;
    thumb_url: string | null;
    mime_type: string;
    width: number | null;
    height: number | null;
}

interface ReactionGroup {
    emoji: string;
    count: number;
    user_ids: string[];           // So client knows if current user reacted
}

interface VoiceState {
    user_id: string;
    channel_id: string;
    self_mute: boolean;
    self_deafen: boolean;
    server_mute: boolean;
    speaking: boolean;
}
```

---

## REST API

Base URL: `/api/v1`

All authenticated endpoints require `Authorization: Bearer <token>` header.

### Auth

```
POST /api/v1/auth/register
    Body: { username: string, password?: string }
    Response: { user: User, token: string }

POST /api/v1/auth/login
    Body: { username: string, password?: string }
    Response: { user: User, token: string }
```

### Channels

```
GET /api/v1/channels
    Response: Channel[]

POST /api/v1/channels
    Body: { name: string, type: "voice" | "text" }
    Response: Channel

DELETE /api/v1/channels/:id
    Response: 204

PATCH /api/v1/channels/reorder
    Body: { channel_ids: string[] }
    Response: 204
```

### Messages (History)

```
GET /api/v1/channels/:id/messages?limit=50&before=<message_id>
    Response: Message[]
    Notes: Cursor-based pagination. Returns newest first.
           `before` is optional — omit for latest messages.
           `limit` defaults to 50, max 100.
```

> **Note:** Message edit and delete are WebSocket-only operations (`edit_message`, `delete_message`). This is intentional — these are real-time actions that require an active connection for broadcasting updates to other clients. History retrieval is the only message-related REST endpoint.

### Upload

```
POST /api/v1/upload
    Content-Type: multipart/form-data
    Field: "file" — the image file
    Response: { id: string, url: string, thumb_url: string, filename: string, mime_type: string, width: number, height: number }
    Constraints:
        - Max file size: 10MB
        - Allowed MIME types: image/jpeg, image/png, image/gif, image/webp
        - Server generates thumbnail (max 400px wide)
        - Files stored at /data/uploads/<first2>/<next2>/<hash>.<ext>
        - Thumbnails at /data/thumbs/<first2>/<next2>/<hash>.<ext>
```

### Static File Serving

```
GET /uploads/...    → Serves from data/uploads/
GET /thumbs/...     → Serves from data/thumbs/
GET /avatars/...    → Serves from data/avatars/
GET /               → Serves embedded SPA (index.html)
GET /assets/...     → Serves embedded SPA assets
```

---

## Voice Architecture (SFU)

### Overview

The server runs a **Selective Forwarding Unit (SFU)** using Pion. Each voice channel is a "room." The SFU receives each user's audio and forwards it to all other users in the room without transcoding. This gives O(n) bandwidth at the server instead of O(n²) for peer-to-peer mesh, and keeps latency minimal since there's no encoding/decoding step.

### Connection Flow

```
1. Client sends WS: { op: "join_voice", d: { channel_id: "..." } }

2. Server creates a PeerConnection for this client in the room.
   Server sends WS: { op: "webrtc_offer", d: { sdp: "..." } }
   - The offer includes one recvonly track per existing participant
   - And one sendrecv track for the client's own audio

3. Client responds with WS: { op: "webrtc_answer", d: { sdp: "..." } }

4. ICE candidates exchanged via WS: { op: "webrtc_ice", d: { candidate: ... } }

5. Client sends audio via their sendrecv track.
   SFU receives it and writes the RTP packets to every other peer's
   corresponding recvonly track.

6. When a new user joins, existing PeerConnections are renegotiated
   to add a new recvonly track for the new participant.

7. When a user leaves, their track is removed and PeerConnections
   are renegotiated.
```

### Pion SFU Room Implementation Notes

- Each room maintains a map of `peerID → *webrtc.PeerConnection`
- When peer A publishes a track, the SFU subscribes all other peers by adding a `TrackLocal` to their PeerConnection
- Use `OnTrack` callback to receive remote tracks, then `AddTrack` on subscriber PeerConnections
- Renegotiation: after adding/removing tracks, create a new offer and send via WS
- Use `pion/interceptor` for NACK/PLI support (not critical for audio-only but good practice)

### Audio Configuration

```go
// Codec preference: Opus only
mediaEngine := &webrtc.MediaEngine{}
mediaEngine.RegisterCodec(webrtc.RTPCodecParameters{
    RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType:    webrtc.MimeTypeOpus,
        ClockRate:   48000,
        Channels:    1,    // Mono — voice chat doesn't need stereo
        SDPFmtpLine: "minptime=10;useinbandfec=1;usedtx=1",
    },
    PayloadType: 111,
}, webrtc.RTPCodecTypeAudio)
```

Key Opus parameters:
- `usedtx=1` — Discontinuous Transmission: stops sending when silent, saves bandwidth
- `useinbandfec=1` — Forward Error Correction: recovers from packet loss without retransmit
- `minptime=10` — Minimum packet time: allows 10ms frames (though 20ms is the sweet spot)

### ICE / STUN Configuration

Since the SFU runs on the same machine clients connect to, ICE will typically resolve to a direct host or server-reflexive candidate. Bundle a lightweight STUN response in the Go server or use a public STUN server:

```go
config := webrtc.Configuration{
    ICEServers: []webrtc.ICEServer{
        {URLs: []string{"stun:stun.l.google.com:19302"}},
    },
}
```

For LAN-only deployments, ICE candidates will be host candidates with no STUN needed.

If clients are behind restrictive NATs and the server has a public IP, configure the SFU's public IP:

```go
settingEngine := webrtc.SettingEngine{}
settingEngine.SetNAT1To1IPs([]string{"<public-ip>"}, webrtc.ICECandidateTypeHost)
```

---

## Mute System

There are three distinct mute operations, each enforced at a different layer:

### 1. Self-Mute (Client-Side Mic Mute)

User clicks the mute button → their outgoing audio track is disabled locally.

```typescript
// Client-side
function toggleSelfMute(localStream: MediaStream, muted: boolean) {
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
        // When disabled: sends silence frames (or nothing with DTX)
        // WebRTC connection stays alive — no renegotiation needed
    });

    // Notify server so others see mute icon
    ws.send({ op: "voice_self_mute", d: { muted } });
}
```

The server broadcasts a `voice_state_update` with `self_mute: true` to all users in the channel.

### 2. Self-Deafen (Client-Side Audio Output Mute)

User clicks the deafen button → all incoming audio is muted locally. This is a client-only operation.

```typescript
function toggleSelfDeafen(deafened: boolean) {
    // Mute all incoming audio gain nodes
    userAudioNodes.forEach(node => {
        node.gain.gain.value = deafened ? 0 : node.savedVolume;
    });

    // Notify server so others see deafen icon
    ws.send({ op: "voice_self_deafen", d: { deafened } });
}
```

### 3. Local Mute (Client-Side Per-User)

Right-click a user → "Mute" → their audio is silenced at your GainNode. Only you are affected. The server is not involved. The muted user does not know.

```typescript
// Per-user audio chain
interface UserAudioNode {
    source: MediaStreamAudioSourceNode;
    gain: GainNode;
    analyser: AnalyserNode;
    volume: number;        // User's volume setting (0.0 - 2.0)
    localMuted: boolean;   // Is this user locally muted by us?
}

function setUserLocalMute(userId: string, muted: boolean) {
    const node = userAudioNodes.get(userId);
    if (!node) return;
    node.localMuted = muted;
    node.gain.gain.value = muted ? 0 : node.volume;
}
```

### 4. Server-Mute (Admin-Enforced)

An admin mutes a disruptive user → the SFU stops forwarding that user's audio packets to all subscribers. This is enforced server-side and cannot be bypassed by the client.

```
Admin client → WS: { op: "voice_server_mute", d: { user_id: "X", muted: true } }

Server:
    1. Mark user X as server_muted in the room state
    2. Stop writing user X's RTP packets to other peers' TrackLocal
       (track stays subscribed so unmute is instant — just stop forwarding)
    3. Broadcast voice_state_update with server_mute: true to all users
    4. Send voice_state_update to user X so their UI reflects the mute
```

In Pion, implement this by checking a `serverMuted` flag in the RTP forwarding loop. When muted, simply don't call `trackLocal.WriteRTP()` for that peer's packets.

### Voice State Summary (per user in a voice channel)

```go
type VoiceState struct {
    UserID     string `json:"user_id"`
    ChannelID  string `json:"channel_id"`
    SelfMute   bool   `json:"self_mute"`
    SelfDeafen bool   `json:"self_deafen"`
    ServerMute bool   `json:"server_mute"`
    Speaking   bool   `json:"speaking"`
}
```

All state changes are broadcast via `voice_state_update` events.

---

## Client-Side Audio Pipeline

### Per-User Receive Chain

For each remote audio track received via WebRTC, create this audio processing chain:

```
Remote MediaStream (from RTCPeerConnection.ontrack)
    │
    ▼
AudioContext.createMediaStreamSource(stream)
    │
    ▼
GainNode (controls: volume slider 0.0–2.0, local mute sets to 0)
    │
    ▼
AnalyserNode (for speaking detection — drives the green ring indicator)
    │
    ▼
AudioContext.destination (the user's selected speaker)
```

### Speaker/Mic Selection

```typescript
// Enumerate available devices
async function getDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
        microphones: devices.filter(d => d.kind === 'audioinput'),
        speakers: devices.filter(d => d.kind === 'audiooutput'),
    };
}

// Select microphone — get a new stream and replace the track in the PeerConnection
async function selectMicrophone(deviceId: string) {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        }
    });
    const newTrack = stream.getAudioTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track?.kind === 'audio');
    await sender.replaceTrack(newTrack);
}

// Select speaker — use setSinkId on the audio output element
async function selectSpeaker(deviceId: string) {
    // setSinkId is available on HTMLMediaElement
    // For WebAudio destination, you need to route through an <audio> element
    // or use AudioContext.setSinkId() (Chrome 110+)
    await audioContext.setSinkId(deviceId);
}
```

### Speaking Detection (Client-Side)

Detect when the local user is speaking using an AnalyserNode. Only send WebSocket updates on state *change*, not every frame.

```typescript
function setupSpeakingDetection(stream: MediaStream) {
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    let wasSpeaking = false;
    const THRESHOLD = 15;  // Tune this value

    // Use setInterval instead of requestAnimationFrame — rAF is throttled
    // or paused entirely when the tab is backgrounded, which would break
    // speaking detection while the user is in another tab.
    const intervalId = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            peak = Math.max(peak, Math.abs(data[i] - 128));
        }
        const isSpeaking = peak > THRESHOLD;
        if (isSpeaking !== wasSpeaking) {
            wasSpeaking = isSpeaking;
            ws.send({ op: "voice_speaking", d: { speaking: isSpeaking } });
        }
    }, 50);

    // Return cleanup function for when the user leaves voice
    return () => clearInterval(intervalId);
}
```

---

## Image Upload & Attachment Flow

### Upload Flow

```
1. User drags image onto chat area OR clicks "+" button and selects file
2. Client validates: file type (jpeg/png/gif/webp), file size (≤ 10MB)
3. Client shows upload progress indicator in the message input area
4. Client sends: POST /api/v1/upload (multipart/form-data)
5. Server validates MIME type (by reading magic bytes, not just extension)
6. Server generates UUID for attachment ID
7. Server hashes file content (SHA-256), stores at:
     /data/uploads/<hash[0:2]>/<hash[2:4]>/<hash>.<ext>
   This deduplicates identical uploads automatically.
8. Server generates thumbnail (max 400px wide, preserving aspect ratio)
     /data/thumbs/<hash[0:2]>/<hash[2:4]>/<hash>.<ext>
9. Server extracts image dimensions
10. Server inserts attachment row in DB (not yet linked to a message)
11. Server responds: { id, url, thumb_url, filename, mime_type, width, height }
12. Client includes the attachment ID when sending the message:
     WS: { op: "send_message", d: { channel_id, content, attachment_ids: ["..."] } }
13. Server links attachment to message, broadcasts message_create with attachments
```

### Orphaned Attachment Cleanup

Attachments are uploaded before being linked to a message (`message_id` is NULL in the DB until send). If a user uploads an image but never sends the message (e.g., closes the tab), the attachment becomes orphaned. The server runs a periodic cleanup goroutine (every 10 minutes) that deletes attachments where `message_id IS NULL AND created_at < datetime('now', '-1 hour')`, removing both the DB row and the file on disk.

### Client-Side Upload Implementation

Support two entry points that feed into the same upload function:

**Drag and Drop:**
```typescript
// On the message area container
onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
onDragLeave={() => setDragActive(false)}
onDrop={(e) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    files.forEach(uploadFile);
}}
```

**Click "+" Button:**
```typescript
// Hidden file input triggered by the + button
<input type="file" accept="image/*" multiple hidden ref={fileInputRef}
    onChange={(e) => Array.from(e.target.files).forEach(uploadFile)} />
<button onClick={() => fileInputRef.click()}>+</button>
```

### Image Display in Messages

- Show thumbnail inline in the message (max 400px wide, max 300px tall, preserve aspect ratio)
- Click thumbnail to open full-size image in a lightbox/modal overlay
- Show filename below the image
- Support multiple images per message (display in a grid if > 1)

---

## @Mentions

### How Mentions Work

1. User types `@` in the message input
2. Client shows autocomplete dropdown of online users, filtered as user types
3. User selects a user from dropdown (click or Enter)
4. Input shows the mention as a styled token: `@username`
5. The message content stores mentions as `<@user_id>` in the raw text
6. When sending, the client also extracts mentioned user IDs from the content
7. Server parses `<@user_id>` patterns, inserts into `mentions` table
8. Server broadcasts `message_create` with `mentions: ["user_id_1", ...]`
9. Receiving clients render `<@user_id>` as highlighted `@username` text
10. If the current user is mentioned, the channel shows an indicator (e.g., white dot / badge)

### Mention Format in Message Content

```
Raw content stored in DB: "Hey <@abc123> check this out"
Displayed in UI:          "Hey @alice check this out"
                                ^^^^^^ (highlighted, colored)
```

---

## Reply System

### How Replies Work (Discord-Style)

1. User hovers over a message → a "Reply" button appears
2. User clicks Reply → a reply preview bar appears above the message input showing:
   `Replying to @username: "first 100 chars of message..."`
   With an X button to cancel the reply.
3. User types their reply and sends
4. Message is created with `reply_to_id` set to the original message's ID
5. In the message list, the reply message shows a small preview above it:
   - Small text showing the original author's avatar + name + first ~100 chars of content
   - Clicking this preview scrolls to and highlights the original message

### Reply Data in message_create

```json
{
    "id": "msg_new",
    "reply_to": {
        "id": "msg_original",
        "author": { "id": "...", "username": "alice", "avatar_url": "..." },
        "content": "First 100 characters of the original message..."
    },
    "content": "My reply to alice's message",
    ...
}
```

The server populates `reply_to` with the referenced message's author and truncated content so the client doesn't need a separate fetch.

---

## Reaction System

### How Reactions Work

1. User hovers over a message → a small emoji button (e.g., smiley face icon) appears
2. Clicking it opens a compact emoji picker (grid of common emojis)
3. User clicks an emoji → client sends `add_reaction`
4. Server inserts into `reactions` table (idempotent — primary key prevents duplicates)
5. Server broadcasts `reaction_add` to all users in the channel
6. Below the message, reactions display as: `👍 3  ❤️ 1  😂 2`
   - Each reaction shows the emoji and count
   - Highlighted/outlined if the current user has reacted with that emoji
   - Clicking an existing reaction toggles it (add if not reacted, remove if already reacted)
7. Hovering over a reaction shows a tooltip with the usernames who reacted

---

## Authentication (Simple)

Keep auth minimal. No OAuth, no email verification. This is a self-hosted tool for small groups.

### Flow

1. First visit: user sees a login/register screen
2. User enters a username (and optional password if the server is configured to require them)
3. Server creates user + returns a token
4. Token stored in `localStorage`, sent as `Authorization: Bearer <token>` on REST calls and via `authenticate` op on WebSocket connection (see WebSocket Protocol)
5. Token validated on each request

### Passwordless Mode

When the server does not require passwords (`password_hash` is NULL):
- **Register**: Any new username is accepted. The server creates the user and returns a token.
- **Login**: The server checks that the username exists and returns a new token. No password check.
- **Security implication**: Anyone who knows a username can log in as that user. This is acceptable for trusted LAN/friend-group deployments. For public-facing servers, passwords should be required (enforced via a `--require-password` flag).

### Admin Role

The first user to register is automatically an admin (`is_admin = TRUE` in the `users` table). Admins can:
- Delete any message
- Server-mute users
- Delete channels
- (Future: ban users)

---

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  VoiceChat                                    [user] ⚙️  │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  VOICE       │   (Main content area)                    │
│  ─────────   │                                          │
│  🔊 General  │   If text channel selected:              │
│    alice 🔇  │   ┌──────────────────────────────────┐   │
│    bob  🎤   │   │  Message list (scrollable)       │   │
│  🔊 Gaming   │   │  ┌─────────────────────────────┐ │   │
│              │   │  │ @alice  10:30 AM             │ │   │
│  TEXT        │   │  │ Hey everyone!                │ │   │
│  ─────────   │   │  │              👍2  ❤️1        │ │   │
│  # general   │   │  │                             │ │   │
│  # random    │   │  │ ↳ replying to @alice         │ │   │
│              │   │  │ @bob  10:31 AM               │ │   │
│  [+ Channel] │   │  │ Hey! Check this out          │ │   │
│              │   │  │ [image_thumbnail.jpg]        │ │   │
│              │   │  └─────────────────────────────┘ │   │
│              │   └──────────────────────────────────┘   │
│              │   ┌──────────────────────────────────┐   │
│              │   │ [+]  Type a message...    [Send] │   │
│              │   │ (Replying to @alice)         [X] │   │
│              │   └──────────────────────────────────┘   │
│              │                                          │
│──────────────│   If voice channel selected:             │
│ 🎤 Mute      │   Grid of user cards with speaking       │
│ 🔇 Deafen    │   indicators. Right-click for volume.    │
│ 📞 Disconnect│                                          │
│ 🎙️ Mic: ...  │                                          │
│ 🔊 Spkr: ... │                                          │
└──────────────┴──────────────────────────────────────────┘
```

### Sidebar (Left Panel, ~240px)

- **Voice channels section**: listed with 🔊 icon. Under each voice channel, show users currently in it with their mute/deafen/speaking status icons
- **Text channels section**: listed with # icon. Show unread indicator (dot/badge) if there are unread messages or mentions
- **Create channel button** at the bottom: opens a modal to enter name and select type
- **Voice controls bar** at the very bottom of the sidebar (only visible when connected to voice):
  - Mute/Unmute mic button
  - Deafen/Undeafen button
  - Disconnect button
  - Current mic dropdown
  - Current speaker dropdown

### Main Content Area

- Shows the selected channel's content
- **Text channel**: message list with infinite scroll upward for history, message input at bottom
- **Voice channel**: grid of user cards showing avatar, username, speaking ring animation, mute icons

### Theme

- Dark theme (Discord-like dark grays)
- Use CSS custom properties for all colors so theming is trivial later
- Suggested palette:
  ```css
  :root {
      --bg-primary: #1e1f22;
      --bg-secondary: #2b2d31;
      --bg-tertiary: #313338;
      --text-primary: #f2f3f5;
      --text-secondary: #b5bac1;
      --text-muted: #6d6f78;
      --accent: #5865f2;
      --accent-hover: #4752c4;
      --danger: #ed4245;
      --success: #57f287;
      --mention-bg: rgba(88, 101, 242, 0.15);
      --mention-text: #c9cdfb;
  }
  ```

---

## Build & Distribution

### Development

```bash
# Terminal 1: Frontend dev server with HMR
cd client && npm install && npm run dev

# Terminal 2: Go server (proxies to Vite dev server for frontend)
cd server && go run . --dev --port 8080
```

In `--dev` mode, the Go server proxies non-API requests to `localhost:5173` (Vite dev server). In production, it serves the embedded SPA.

### Production Build

```bash
# 1. Build the frontend
cd client && npm run build    # Output: client/dist/

# 2. Build the server (embeds client/dist/ via go:embed)
cd server && go build -o voicechat .

# Result: single binary (~15-20MB)
```

### Running

```bash
# Minimal — just run it
./voicechat

# With options
./voicechat \
    --port 8080 \
    --data-dir ./data \
    --max-upload-size 10485760
```

The binary:
- Creates `./data/` directory if it doesn't exist (SQLite DB + uploads + thumbs)
- Starts HTTP/WS server
- Prints `Server running at http://localhost:8080`
- Opens browser automatically (if `--open` flag provided)

### Tauri Desktop Wrapper (Optional)

For users who want a desktop app:
- Tauri app launches the Go binary as a sidecar process
- Tauri webview points to `localhost:<port>`
- Result: ~20MB app (Go binary + Tauri shell) vs ~170MB for Electron
- Benefits: system tray icon, global keyboard shortcuts for mute/deafen

---

## Implementation Order

Build in this order. Each step produces a testable, usable increment.

### Phase 1: Foundation
1. **Go server skeleton** — HTTP server, static file serving, config flags
2. **SQLite setup** — connection, WAL mode, migration runner, schema creation
3. **Auth** — register, login, token middleware
4. **WebSocket hub** — connect, auth, read/write pumps, broadcast

### Phase 2: Text Chat
5. **Channel CRUD** — create/list/delete channels via REST + WS broadcast
6. **Message sending** — WS send → DB insert → broadcast message_create
7. **Message history** — REST endpoint with cursor pagination
8. **Replies** — reply_to_id on messages, populated reply context in broadcasts
9. **@Mentions** — parse `<@user_id>`, insert into mentions table, highlight in UI
10. **Reactions** — add/remove/toggle, display with counts
11. **Image upload** — multipart upload, thumbnail generation, attachment linking

### Phase 3: Voice
12. **Pion SFU setup** — MediaEngine, room management, peer connection lifecycle
13. **WebRTC signaling** — offer/answer/ICE exchange over existing WebSocket
14. **Audio forwarding** — SFU receives tracks, forwards to subscribers
15. **Join/leave voice** — room management, presence updates, renegotiation
16. **Self-mute/deafen** — client-side track disable + state broadcast
17. **Server-mute** — admin-enforced RTP forwarding stop
18. **Per-user volume** — GainNode audio chain on client
19. **Mic/speaker selection** — device enumeration, track replacement, setSinkId
20. **Speaking detection** — AnalyserNode on client, state broadcast

### Phase 4: Polish
21. **Reconnection** — WebSocket auto-reconnect with exponential backoff, voice rejoin
22. **Unread indicators** — track last-read message per channel per user
23. **Typing indicators** — throttled, auto-expire after 5 seconds
24. **Image lightbox** — click thumbnail to view full size
25. **Emoji picker** — compact grid of common emojis for reactions
26. **Desktop build** — Tauri sidecar setup

---

## Performance Considerations

- **WebSocket messages**: JSON is fine at this scale. Don't prematurely optimize to protobuf.
- **Message rendering**: Virtualize the message list (only render visible messages). Use SolidJS `<For>` with keyed updates.
- **SQLite**: WAL mode + `PRAGMA synchronous=NORMAL` for 2x write speed with acceptable durability.
- **Image thumbnails**: Generate on upload, not on request. Serve with aggressive `Cache-Control` headers.
- **Audio**: Opus DTX eliminates bandwidth for silent users. The SFU forwarding loop should be the tightest code in the server — no allocations in the hot path.
- **Reconnection**: WebSocket should reconnect with exponential backoff (1s, 2s, 4s, max 30s). On reconnect, fetch missed messages since last received message ID.

---

## Rate Limiting

Apply per-user rate limits server-side to prevent abuse. Use a simple token bucket or sliding window per user ID.

| Operation | Limit | Window |
|-----------|-------|--------|
| `send_message` | 5 messages | per 5 seconds |
| `add_reaction` / `remove_reaction` | 10 reactions | per 10 seconds |
| `typing_start` | 1 event | per 3 seconds (client should also throttle) |
| `POST /api/v1/upload` | 3 uploads | per 30 seconds |
| `POST /api/v1/auth/register` | 3 attempts | per minute (by IP) |
| `POST /api/v1/auth/login` | 5 attempts | per minute (by IP) |

When a rate limit is exceeded, the server sends a WS error or returns HTTP 429 with a `Retry-After` header. The client should display a brief "slow down" indicator.

---

## Configuration

```go
type Config struct {
    Port          int    `env:"PORT" default:"8080"`
    DataDir       string `env:"DATA_DIR" default:"./data"`
    MaxUploadSize int64  `env:"MAX_UPLOAD_SIZE" default:"10485760"` // 10MB
    DevMode       bool   `flag:"dev"`
    PublicIP      string `env:"PUBLIC_IP"`  // For SFU NAT traversal, optional
    STUNServer    string `env:"STUN_SERVER" default:"stun:stun.l.google.com:19302"`
}
```

All configurable via CLI flags or environment variables.
