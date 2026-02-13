# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Self-hostable Discord alternative ("Le Faux Pain"). Single Go binary with an embedded SolidJS SPA. Text channels with replies/reactions/mentions/uploads, voice channels via Pion WebRTC SFU.

## Build & Dev Commands

```bash
# Dev mode (two terminals)
cd client && npm install && npm run dev          # Vite HMR on :5173
cd server && go run . --dev --port 8080          # Proxies frontend to Vite

# Production build (order matters: frontend first, then copy, then Go)
cd client && npm run build
rm -rf server/static/assets/* server/static/index.html
cp -r client/dist/* server/static/
cd server && go build -o voicechat .
```

There are no tests. There is no linter configured.

## Architecture

**Backend** (`server/`): Go 1.24, module `github.com/kalman/voicechat`
- `main.go` — wires everything: DB, SFU, WS Hub, HTTP router, orphan cleanup goroutine
- `db/` — SQLite via `modernc.org/sqlite`. WAL mode, `MaxOpenConns(1)`, foreign keys ON. Migrations run on startup.
- `api/` — REST endpoints: auth (register/login), channel CRUD, message history (cursor pagination), file upload with thumbnail generation
- `ws/` — Single WebSocket per user. First message must be `authenticate`. Hub broadcasts all real-time events (chat, voice state, presence). All ops in `handlers.go`.
- `sfu/` — Pion WebRTC SFU. One Room per voice channel, one PeerConnection per user. Opus-only (`Channels: 2` per RFC 7587). Renegotiates all peers when someone joins/leaves.
- `storage/` — Hash-based file storage with deduplication
- `embed.go` — `go:embed static/*` (used in non-nginx mode)

**Frontend** (`client/`): SolidJS + TypeScript + Vite
- `src/stores/` — State as SolidJS signals (`createSignal`). Key stores: `auth.ts` (token in localStorage), `channels.ts`, `messages.ts`, `users.ts`, `voice.ts`
- `src/lib/ws.ts` — WebSocket client with reconnect backoff. All incoming messages dispatched via `onMessage()` observer pattern.
- `src/lib/webrtc.ts` — Voice: `joinVoice`/`leaveVoice`, sends/receives SDP and ICE candidates over WS
- `src/lib/audio.ts` — Per-user audio chain: MediaStreamSource → GainNode → AnalyserNode → destination
- `src/lib/events.ts` — Maps WS ops to store updates (the central event dispatcher)
- `src/lib/api.ts` — REST client (`fetch` with Bearer token)
- `src/components/` — Sidebar (channel list), TextChannel (messages + input), VoiceChannel (user grid + controls), Settings, Auth

## Key Patterns

**WebSocket protocol**: `{ op: string, d: any }`. Client authenticates within 5 seconds of connecting. Server responds with `ready` containing full initial state. All mutations go through WS (not REST).

**SFU signaling**: Voice join → server creates PeerConnection → sends `webrtc_offer` → client responds with `webrtc_answer` → ICE candidates exchanged via `webrtc_ice`. Renegotiation uses `needsRenegotiation` flag to avoid race conditions when signaling state isn't stable.

**SolidJS reactivity pitfall**: `<Show>` without `keyed` uses truthiness equality (`!a === !b`) on its condition memo — switching between two truthy values won't re-render children. Use reactive function children `{() => { ... }}` for dynamic component swapping based on signal values, or use `<Show keyed>`.

**SQLite single-writer**: `MaxOpenConns(1)` is intentional. All writes serialize through one connection. WAL mode allows concurrent reads.

**Attachment flow**: Upload via REST (returns attachment ID) → include ID in `send_message` WS op → server links attachment to message. Orphaned attachments (unlinked after 1 hour) cleaned up by background goroutine.
