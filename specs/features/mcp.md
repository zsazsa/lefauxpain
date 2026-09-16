# Feature: MCP Integration

## Intent

Let people connect their own AI assistant (Claude Desktop, Claude Code, or any
Model Context Protocol client) to a Le Faux Pain server, so the assistant can
read what is happening in channels, search history, read channel documents and
post messages — always acting as one specific user, with exactly that user's
permissions.

## Current Behavior

The only programmatic write path is the admin-managed webhook API, which posts
as a shared bot user. There is no way for an individual to grant an AI tool
read access, and nothing enforces per-user scoping for automation.

## New Behavior

### Personal API keys

- Any approved user can create up to 20 named API keys from Settings → API / MCP.
- Keys are prefixed `lfp_`, stored as SHA-256 hashes with a display prefix, and
  shown in full exactly once at creation.
- A user sees and revokes only their own keys. Deleting the user cascades.
- `last_used_at` is updated on every authenticated MCP request.

REST:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/api-keys` | List own keys (no secrets) |
| POST | `/api/v1/api-keys` | `{"name"}` → 201 with the full key once |
| DELETE | `/api/v1/api-keys/{id}` | Revoke own key (404 for anyone else's) |

### MCP endpoint

`POST /api/v1/mcp` implements the MCP Streamable HTTP transport in stateless
mode (no session ids, no server-initiated stream; `GET` answers 405 as the
spec allows). Auth is `Authorization: Bearer <lfp_ key or session token>`.
Rate limit: 120 requests/minute per IP.

JSON-RPC methods: `initialize`, `ping`, `tools/list`, `tools/call`,
`resources/list`, `resources/templates/list`, `prompts/list`,
`logging/setLevel`. Notifications return 202 with no body. Batches are
accepted. Protocol versions 2024-11-05 through 2025-11-25 are echoed back;
anything else negotiates to 2025-06-18.

`initialize` returns `instructions` naming the acting user and reminding the
model that sent messages appear under that user's name.

### Tools

All channel arguments accept a name (with or without `#`) or an id. A channel
the user cannot read is reported as "channel not found" — never as forbidden —
so private channels are not enumerable.

| Tool | Arguments | Behaviour |
|------|-----------|-----------|
| `list_channels` | — | Text channels the user can read: public ones plus channels they are a member of (admins see all) |
| `read_messages` | `channel`, `limit` (1-100, default 30), `before` (message id) | Newest first, deleted messages omitted, thread replies excluded like the REST history |
| `search_messages` | `query`, `channel?`, `limit` (default 25) | Case-insensitive substring search over readable channels |
| `send_message` | `channel`, `content` (1-4000 chars) | Posts as the user; non-public channels require membership; broadcast scoped to channel visibility |
| `list_users` | — | Approved users with online flag (bot user excluded) |
| `list_documents` | `channel` | Metadata of the channel's markdown documents |
| `read_document` | `channel`, `path` | Full document content |

### Radio tools

Radio tools run the same WebSocket applet handlers the web client uses,
via `Hub.ExecuteAs`, so permissions and broadcasts are identical. Stations
and playlists accept a name (case-insensitive) or an id.

| Tool | Arguments | Behaviour |
|------|-----------|-----------|
| `list_stations` | — | Every station: mode, public controls, managers, whether you can manage/control, listener count, current playback |
| `station_status` | `station` | The above plus every playlist with its tracks; playback position is live |
| `create_station` | `name` (1-32) | Creates a station; caller becomes manager; duplicate names refused |
| `create_playlist` | `station`, `name` (1-64) | Empty playlist owned by the caller. Tracks are added over REST (see below); MCP itself cannot carry audio |
| `radio_play` | `station`, `playlist?` | With a playlist: play it from the top. Without: resume if paused, else first playlist with tracks |
| `radio_pause` / `radio_resume` / `radio_stop` | `station` | Pause at the live position / resume / stop |
| `radio_next` | `station` | Next track; at the end the station's mode applies |
| `radio_seek` | `station`, `position` | Seconds into the current track, clamped to its duration |
| `set_station_mode` | `station`, `mode` | `play_all`, `loop_one`, `loop_all`, `single`. Managers only |
| `set_public_controls` | `station`, `enabled` | Let everyone control playback. Managers only |
| `reorder_tracks` | `station`, `playlist`, `track_ids` | Full permutation of the playlist's track ids. Playlist owner (or admin) only |

### Adding tracks with an API key

`POST /api/v1/radio/playlists/{id}/tracks` and `DELETE /api/v1/radio/tracks/{id}`
accept `Authorization: Bearer lfp_...` in addition to session tokens
(`WrapWithAPIKey`). This is the only REST surface a personal key unlocks
besides `/api/v1/mcp`; the key still acts strictly as its owner, so only the
playlist owner can add or remove tracks. Upload is multipart with `file` and
an optional `duration` (seconds); rate limit 5 per 30 s per IP.

Playback control (`radio_play`/`pause`/`resume`/`next`/`seek`/`stop`) needs
manager rights or public controls, exactly like the web client. Because the
underlying handlers are silent, each tool validates preconditions first and
reports the resulting playback state (or a tool error) afterwards.

Tool failures (bad arguments, not found, validation) come back as MCP tool
results with `isError: true`, not JSON-RPC errors, so the model can recover.

### Out of scope

Uploading audio through MCP itself, listening (tuning is a client-side audio concern), deleting
stations or playlists, station manager changes, mentions and thread replies
via MCP, unfurling of URLs in MCP-sent messages, reactions, voice, and
OAuth-based authorization. Session tokens are accepted
on the endpoint for convenience but keys are the documented path.

## Constraints

- Never widen what a user can see: every tool goes through `CanAccessChannel`
  or the equivalent membership filter in SQL.
- The endpoint must stay usable from Claude Code with a single
  `claude mcp add --transport http` command and a bearer header.
- Keep the server dependency-free for MCP; the protocol surface used here is
  small enough to implement directly.
