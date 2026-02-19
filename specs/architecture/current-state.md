# Current System State

## What It Does

Le Faux Pain is a self-hostable Discord alternative for small groups. Users get text channels with replies, reactions, mentions, and file uploads; voice channels with mute/deafen/server-mute and speaking detection; screen sharing (desktop app only, via PipeWire); a synchronized media player for watching videos together; and a radio station system where users create playlists, DJ for each other, and see live waveform visualizations. The whole thing ships as a single Go binary with an embedded SolidJS SPA, plus a Tauri desktop app for Linux with native Rust voice/screen engines that bypass webkit2gtk's broken WebRTC.

## Tech Stack

- **Language:** Go 1.24 (backend), TypeScript (frontend), Rust (desktop native voice/screen)
- **Framework:** SolidJS (frontend), Tauri 2 (desktop shell)
- **Database:** SQLite (pure-Go via `modernc.org/sqlite`, WAL mode, single-writer `MaxOpenConns(1)`)
- **Hosting:** Single Linode VPS (172.233.131.169), nginx reverse proxy, Let's Encrypt SSL
- **Key integrations:** Pion WebRTC v4 (SFU), nhooyr.io/websocket, webrtc-rs (desktop), PipeWire portal (screen capture), NVENC/VAAPI/openh264 (screen encoding)

## Surfaces

- [x] Web app — https://lefauxpain.com
- [x] API — https://lefauxpain.com/api/v1 (REST for auth/upload/history; everything else is WebSocket)
- [x] WebSocket — wss://lefauxpain.com/ws (single connection per user, first-message auth)
- [x] Desktop app — Linux only (Tauri 2 + Rust voice engine). Server selector page, not the SPA.
- [ ] Mobile app — none (responsive web only)
- [ ] CLI — none

## Known Fragile Areas

- **SFU renegotiation timing** — When a user joins/leaves voice while another offer/answer exchange is in-flight, renegotiation is deferred via a `needsRenegotiation` flag checked in `HandleAnswer`. Correct but subtle — a missed flag means a peer silently stops hearing someone. Same pattern used for screen share viewers.

- **`sendReady` is a god function** (`server/ws/client.go:136-332`) — Assembles the entire initial state snapshot from 10+ sequential DB queries. No parallelism. If any query silently fails (errors are discarded with `_`), that section of state is just empty. A user connects and silently has no playlists, no notifications, etc.

- **Radio `advancePlaybackMode`** (`server/ws/handlers.go:1668-1776`) — Four-way switch (play_all/loop_one/loop_all/single) with playlist advancement, wrap-around, and DB lookups. The logic for "find next playlist with tracks, optionally wrapping" across `getNextPlaylistTracks` is correct but dense.

- **Radio playback state is in-memory only** — Lives in `hub.radioPlayback` behind `radioMu`. Server restart = all stations stop. No persistence. Same for media playback state.

- **Desktop ICE race condition** — Desktop Rust engine sends ICE candidates before the server has set the remote description. Pion queues them so it's non-fatal, but it's technically wrong ordering and logs warnings.

- **RTCP PLI ignored on desktop** — Desktop's RTCP read loop discards all packets. PLI (Picture Loss Indication) from the SFU goes unhandled. Periodic IDR keyframes every 60 frames are the workaround. Late-joining screen share viewers may see corruption briefly.

- **WS send buffer overflow = instant disconnect** (`server/ws/client.go`) — If a client's send channel (cap 256) is full, they're disconnected immediately. No backpressure, no warning. A slow client during a burst of messages just gets dropped.

- **Admin auth is per-handler, not middleware** — Each handler individually checks `c.User.IsAdmin`. Easy to forget on a new endpoint. No centralized admin gate.

- **`channel_reads` table exists but is underutilized** — Schema is there (migration v1) but unread indicators aren't fully wired up in the frontend. The table gets written to but the read state isn't surfaced.

- **Orphan attachment cleanup** — Background goroutine runs every 10 minutes, deletes attachments unlinked for >1 hour. A crash between upload and `send_message` orphans the file until the next cycle. Not transactional.

- **Single WebSocket per user** — Opening a second tab closes the first connection. The hub's `register` channel handler calls `existing.Close()`. No multi-tab support.

- **No token expiry** — Tokens in the `tokens` table have an `expires_at` column but it's always NULL. Tokens live forever until the user is deleted.

## What Works Reliably

- **Text chat** — Messages, replies, reactions, mentions, notifications, edit/delete, file uploads with thumbnails. Battle-tested across all sessions. Cursor pagination for history works correctly.

- **Voice (browser)** — Join/leave, mute/deafen, server mute, speaking detection. The SFU correctly renegotiates peers on join/leave. Opus codec matching between browser and SFU is solid.

- **Voice (desktop)** — Rust cpal capture → Opus encode → RTP, and RTP → Opus decode → cpal output with multi-track mixing. Resampler handles 44100↔48000 correctly. Speaking detection ported from JS matches behavior.

- **SQLite** — WAL mode + single writer has zero concurrency issues. Pure-Go driver means no CGO hassle. Migrations run reliably on startup.

- **File storage** — SHA-256 hash-based deduplication. Two identical uploads share one file on disk. MIME detection via content sniffing (not headers). Has never lost a file.

- **Auth** — Simple token-based (UUID in `tokens` table). Register → login → Bearer token in REST, first-message auth on WS. Admin approval ("Knock Knock") flow works. bcrypt password hashing.

- **Radio playback synchronization** — Server-authoritative position tracking with `serverNow()` clock offset. Clients correct drift >0.5s every 2 seconds. Seek/pause/resume broadcast correctly. Playback modes (play_all, loop_one, loop_all, single) all work.

- **Deployment pipeline** — Frontend build → scp static files → scp binary → systemctl restart. Takes under 30 seconds. Nginx serves static files directly, proxies API/WS to Go. No downtime complaints.

- **SolidJS reactivity** — Once you know the `<Show>` pitfall (truthiness equality without `keyed`), the reactive stores work predictably. Signals + stores pattern is simple and fast.

## Architecture Overview

### Data Flow

```
Browser/Desktop ←→ nginx (443) ←→ Go binary (8080)
                                      ├── WebSocket Hub (all real-time ops)
                                      ├── REST API (auth, upload, history)
                                      ├── Pion SFU (voice + screen share)
                                      └── SQLite (data/voicechat.db)
```

All real-time mutations go through WebSocket. REST is only for auth, file upload, and message history pagination. Channel creation, messages, reactions, voice state, radio control — all WS.

### WebSocket Protocol

Format: `{ op: string, d: any }`

**Client → Server ops (41 total):**

| Category | Operations |
|----------|-----------|
| Chat | `send_message`, `edit_message`, `delete_message`, `add_reaction`, `remove_reaction`, `typing_start` |
| Channels | `create_channel`, `delete_channel`, `reorder_channels`, `rename_channel`, `restore_channel`, `add_channel_manager`, `remove_channel_manager` |
| Voice | `join_voice`, `leave_voice`, `webrtc_answer`, `webrtc_ice`, `voice_self_mute`, `voice_self_deafen`, `voice_speaking`, `voice_server_mute` |
| Screen | `screen_share_start`, `screen_share_stop`, `screen_share_subscribe`, `screen_share_unsubscribe`, `webrtc_screen_answer`, `webrtc_screen_ice` |
| Notifications | `mark_notification_read`, `mark_all_notifications_read` |
| Media | `media_play`, `media_pause`, `media_seek`, `media_stop` |
| Radio | `create_radio_station`, `delete_radio_station`, `rename_radio_station`, `add_radio_station_manager`, `remove_radio_station_manager`, `set_radio_station_mode`, `create_radio_playlist`, `delete_radio_playlist`, `reorder_radio_tracks`, `radio_play`, `radio_pause`, `radio_resume`, `radio_seek`, `radio_next`, `radio_stop`, `radio_track_ended`, `radio_tune`, `radio_untune` |
| System | `ping` |

**Server → Client events:**

| Category | Events |
|----------|--------|
| System | `ready`, `pong`, `user_online`, `user_offline`, `user_approved` |
| Chat | `message_create`, `message_update`, `message_delete`, `reaction_add`, `reaction_remove`, `typing_start`, `notification_create` |
| Channels | `channel_create`, `channel_delete`, `channel_reorder`, `channel_update` |
| Voice | `voice_state_update`, `webrtc_offer`, `webrtc_ice` |
| Screen | `webrtc_screen_offer`, `webrtc_screen_ice`, `screen_share_started`, `screen_share_stopped`, `screen_share_error` |
| Media | `media_playback`, `media_item_added` |
| Radio | `radio_station_create`, `radio_station_update`, `radio_station_delete`, `radio_playlist_created`, `radio_playlist_deleted`, `radio_playlist_tracks`, `radio_playback`, `radio_listeners` |

### REST Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/v1/health` | No | Health check |
| POST | `/api/v1/auth/register` | No | Register (rate: 3/min) |
| POST | `/api/v1/auth/login` | No | Login (rate: 5/min) |
| POST | `/api/v1/auth/password` | Yes | Change own password |
| GET | `/api/v1/channels` | Yes | List channels |
| GET | `/api/v1/channels/{id}/messages` | Yes | Cursor-paginated history |
| POST | `/api/v1/upload` | Yes | Image upload (10MB, rate: 3/30s) |
| POST | `/api/v1/media/upload` | Yes | Video/audio upload (10GB, rate: 2/min) |
| DELETE | `/api/v1/media/{id}` | Yes | Delete media item |
| GET | `/api/v1/admin/users` | Admin | List all users |
| POST | `/api/v1/admin/users/{id}/admin` | Admin | Set admin status |
| POST | `/api/v1/admin/users/{id}/password` | Admin | Set user password |
| POST | `/api/v1/admin/users/{id}/approve` | Admin | Approve pending user |
| DELETE | `/api/v1/admin/users/{id}` | Admin | Delete user (kicks WS) |
| POST | `/api/v1/radio/playlists/{id}/tracks` | Yes | Upload radio track (500MB, rate: 5/30s) |
| DELETE | `/api/v1/radio/tracks/{id}` | Yes | Delete radio track |

### Database Schema (13 migrations)

| Table | Purpose |
|-------|---------|
| `users` | Accounts (username, bcrypt hash, admin flag, approval status) |
| `tokens` | Bearer auth tokens (UUID, no expiry enforced) |
| `channels` | Text + voice channels (soft-delete via `deleted_at`) |
| `channel_managers` | Per-channel manager permissions |
| `messages` | Chat messages (soft-delete, 4000 char limit) |
| `reactions` | Emoji reactions (compound PK prevents dupes) |
| `attachments` | File uploads (orphan cleanup after 1hr) |
| `mentions` | Message → user mention links |
| `channel_reads` | Unread tracking (schema exists, partially wired) |
| `notifications` | Mention + system notifications (type + JSON data) |
| `media` | Video/audio library items |
| `radio_stations` | Radio stations with playback modes |
| `radio_station_managers` | Per-station manager permissions |
| `radio_playlists` | Playlists belonging to stations |
| `radio_tracks` | Audio tracks with pre-computed waveform peaks |

### Frontend Architecture

SolidJS SPA with no component libraries, no router, no state management library. State lives in `createSignal` stores (`client/src/stores/`). All WS events dispatched through `client/src/lib/events.ts` which updates the appropriate stores.

Key stores: `auth`, `channels`, `messages`, `users`, `voice`, `notifications`, `media`, `radio`, `settings`, `theme`, `responsive`.

### Desktop Architecture

Tauri 2 shell wrapping the same SolidJS SPA. Injects `window.__DESKTOP__ = true` via UserScript. When detected, the frontend routes WebRTC SDP/ICE through Tauri IPC to the native Rust voice engine (`desktop/src-tauri/src/voice/`) instead of browser WebRTC. Screen sharing uses PipeWire portal capture with H.264 encoding (NVENC → VAAPI → openh264 cascade).

## Environment Setup

### Prerequisites

- Go 1.24+
- Node.js 18+ / npm
- For desktop: Rust toolchain, `libopus-dev`, `libasound2-dev`

### Local Development

```bash
# Terminal 1: Frontend with hot reload
cd client && npm install && npm run dev          # Vite HMR on :5173

# Terminal 2: Backend (proxies unknown routes to Vite)
cd server && go run . --dev --port 8080          # API on :8080, SPA proxied to :5173
```

Open http://localhost:5173. First registered user is auto-admin and auto-approved.

### Production Build

```bash
# Order matters: frontend first, then copy into server/static/, then build Go
cd client && npm run build
rm -rf server/static/assets/* server/static/index.html
cp -r client/dist/* server/static/
cd server && go build -o voicechat .

# Result: single binary at server/voicechat
# Run: ./voicechat --port 8080 --data-dir ./data
```

### Desktop Build

```bash
cd desktop/src-tauri && cargo build              # Dev build
cd desktop && npm run tauri dev                  # Dev with hot reload
cd desktop && npm run tauri build                # Release build
```

### Configuration

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--port` | `PORT` | `8080` | HTTP port |
| `--data-dir` | `DATA_DIR` | `./data` | DB + uploads + thumbnails + avatars |
| `--max-upload-size` | `MAX_UPLOAD_SIZE` | `10485760` | Max attachment upload (bytes) |
| `--dev` | — | `false` | Proxy SPA to Vite :5173 |
| `--public-ip` | `PUBLIC_IP` | `""` | Public IP for SFU NAT traversal |
| `--stun-server` | `STUN_SERVER` | `stun:stun.l.google.com:19302` | STUN server |

### Deployment (Current)

```bash
# Frontend
scp -r client/dist/* kalman@172.233.131.169:/opt/voicechat/static/

# Backend
ssh kalman@172.233.131.169 "sudo systemctl stop voicechat"
scp server/voicechat kalman@172.233.131.169:/opt/voicechat/bin/voicechat
ssh kalman@172.233.131.169 "sudo systemctl start voicechat"
```

nginx serves static files from `/opt/voicechat/static/`, proxies `/api/` and `/ws` to Go on :8080, serves uploads/thumbs/avatars directly from `/opt/voicechat/data/`. SSL via Let's Encrypt.
