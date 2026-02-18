# Le Faux Pain

Self-hostable voice and text chat — like Discord, but yours. One Go binary, one SQLite database, no external services required.

<a href="docs/screenshot02.png"><img src="docs/screenshot02.png" alt="Screenshot" width="600"></a>

## Features

### Text Chat
- Channels with real-time messaging via WebSocket
- Replies, emoji reactions, @mentions (with notifications)
- File/image uploads with thumbnails and attachment previews
- Image lightbox viewer
- Typing indicators
- Message editing and soft delete
- Cursor-based pagination for message history

### Voice Chat
- Built-in WebRTC SFU (Pion) — no external TURN/media servers
- Per-user mute, deafen, and server mute (admin)
- Speaking detection with visual indicators
- Join/leave sounds
- 128kbps Opus audio

### Screen Sharing
- Browser-based screen sharing via WebRTC
- Desktop (Tauri) screen sharing via PipeWire capture
- H.264 encoding with hardware acceleration: NVENC (NVIDIA), VAAPI (Intel/AMD), openh264 (software fallback)
- MJPEG local preview
- Live viewer support — watch any user's screen share from the sidebar

### Media Library
- Drag-and-drop video uploads (mp4, webm)
- Synchronized video playback — everyone watches together in sync
- Floating draggable/resizable player panel
- Play/pause/seek controls broadcast to all viewers

### Radio Stations
- Create shared radio stations visible to all users
- Personal playlists with audio track uploads (mp3, ogg, wav, flac, m4a)
- Synchronized audio playback — tune in and hear the same thing as everyone else
- Playlist owner controls playback (pause, skip, stop)
- Auto-advances through playlist, stops after last track
- Floating radio player panel with playlist management

### Applet System
- Sidebar sections (Media Library, Radio Stations) are optional applets
- Toggle applets on/off in Settings > Display
- Preferences stored in localStorage per user

### Admin & Users
- Admin approval system ("Knock Knock") — new users can send a message when registering
- Admin panel: approve/reject users, promote/demote admins, set passwords, delete accounts
- Archived (soft-deleted) channels with restore option
- Channel managers — per-channel permissions for rename/delete

### Theme System
- Multiple color themes (gold, cyan, green) with French and English language options
- French Royal Cyberpunk terminal aesthetic

### Desktop Client (Tauri)
- Native app for Windows, macOS, and Linux
- Server selector — connect to any Le Faux Pain instance
- Native Rust voice engine (bypasses webkit2gtk WebRTC limitations)
- Audio device enumeration via PipeWire or platform APIs
- Auto-update via Tauri updater plugin
- Custom titlebar and system tray integration

### Mobile
- Responsive sidebar drawer for mobile browsers
- Touch-friendly controls

### Security
- MIME type detection on uploads (no extension trust)
- Per-IP rate limiting on auth and upload endpoints
- WebSocket per-user rate limiting (30 msg/sec)
- Server read/write timeouts
- Token-based authentication

## Quick Start (Self-Hosting)

### Prerequisites

- [Go 1.24+](https://go.dev/dl/)
- [Node.js 18+](https://nodejs.org/) with npm

### Build

```bash
git clone https://github.com/zsazsa/lefauxpain.git
cd lefauxpain

# 1. Build the frontend
cd client && npm install && npm run build && cd ..

# 2. Copy frontend into the server embed directory
rm -rf server/static/assets/* server/static/index.html
cp -r client/dist/* server/static/

# 3. Build the server
cd server && go build -o voicechat . && cd ..
```

### Run

```bash
./server/voicechat --port 8080
```

Open `http://localhost:8080` in your browser. That's it — register a username and start chatting.

Data (database, uploads, avatars) is stored in `./data/` by default.

### Server Flags

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--port` | `PORT` | `8080` | HTTP server port |
| `--data-dir` | `DATA_DIR` | `./data` | Where database and uploads are stored |
| `--public-ip` | `PUBLIC_IP` | *(empty)* | Your server's public IP (required for voice chat over the internet) |
| `--stun-server` | `STUN_SERVER` | `stun:stun.l.google.com:19302` | STUN server for WebRTC NAT traversal |
| `--max-upload-size` | `MAX_UPLOAD_SIZE` | `10485760` (10 MB) | Maximum file upload size in bytes |
| `--dev` | — | `false` | Dev mode (proxies frontend requests to Vite on :5173) |

### Production Example

For a server with a public IP at `203.0.113.50`:

```bash
./voicechat --port 8080 --public-ip 203.0.113.50 --data-dir /opt/lefauxpain/data
```

Voice chat requires `--public-ip` to be set to your server's public IP so WebRTC can establish peer connections through NAT.

For HTTPS, put a reverse proxy (nginx, Caddy, etc.) in front. See `docs/deploy.md` for a full nginx + systemd + Let's Encrypt example.

## Connecting to Your Server

### From a Browser

Just open `https://your-domain.com` (or `http://your-ip:8080` without a reverse proxy). Works on desktop and mobile browsers.

### From the Desktop Client

The desktop client is a lightweight native window (Tauri/WebView) that connects to any Le Faux Pain server. It does not include the server — you need a running server to connect to (either self-hosted or someone else's).

Grab the latest release for your platform from [GitHub Releases](https://github.com/zsazsa/lefauxpain/releases/latest):

| Platform | Format | Install |
|----------|--------|---------|
| **Windows** | `.exe` installer or `.msi` | Run the installer |
| **macOS (Apple Silicon)** | `.dmg` | Open and drag to Applications |
| **macOS (Intel)** | `.dmg` | Open and drag to Applications |
| **Linux (Debian/Ubuntu)** | `.deb` | `sudo dpkg -i LeFauxPain_*_amd64.deb` |
| **Linux (Fedora/RHEL)** | `.rpm` | `sudo rpm -i LeFauxPain-*.x86_64.rpm` |
| **Linux (any)** | `.AppImage` | `chmod +x LeFauxPain_*.AppImage && ./LeFauxPain_*.AppImage` |

On first launch, you'll see a connect screen where you enter your server URL (e.g. `https://your-domain.com`). The app remembers your choice for next time.

### Build the Desktop Client Yourself

Requires [Node.js 18+](https://nodejs.org/) and [Rust](https://rustup.rs/).

Linux also needs:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev \
  patchelf libopus-dev libasound2-dev libpipewire-0.3-dev libclang-dev libvpx-dev
```

Then build:

```bash
cd desktop
npm install
npx tauri build
```

Installers will be in `desktop/src-tauri/target/release/bundle/`.

## Development

Run the frontend and backend in separate terminals:

```bash
# Terminal 1 — frontend with hot reload
cd client && npm install && npm run dev

# Terminal 2 — Go server proxying to Vite
cd server && go run . --dev --port 8080
```

The frontend runs on `:5173` with HMR. The Go server on `:8080` proxies frontend requests to Vite in dev mode.

## Architecture

```
┌─────────────┐       ┌──────────────────────────────┐
│   Browser   │◄─────►│         Go Server             │
│  or Tauri   │  WS   │  ┌────────┐  ┌───────────┐   │
│  Desktop    │  +    │  │ WS Hub │  │ Pion SFU  │   │
│  Client     │  HTTP  │  └────┬───┘  └─────┬─────┘   │
└─────────────┘       │       │             │         │
                      │  ┌────▼─────────────▼────┐    │
                      │  │    SQLite (WAL mode)   │    │
                      │  └────────────────────────┘    │
                      └──────────────────────────────┘
```

- **Backend** (`server/`): Go 1.24, SQLite (WAL mode, single writer), WebSocket hub, Pion WebRTC SFU
- **Frontend** (`client/`): SolidJS + TypeScript + Vite
- **Desktop** (`desktop/`): Tauri v2 with native Rust voice engine (webrtc-rs, cpal, Opus)

Single WebSocket connection per user. All real-time events (messages, voice state, presence, media/radio playback) go through the WebSocket. File uploads go through REST, then get linked via WebSocket. In-memory state (media playback, radio playback, voice states) is held in the Hub; persistent data lives in SQLite.

## License

MIT
