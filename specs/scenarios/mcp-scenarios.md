# MCP Scenarios

Validation: `validation/mcp_test.go`

### Scenario MCP01: API key lifecycle
1. Alice `POST /api/v1/api-keys` with a name
2. Assert: 201, response has `id`, `key_prefix` and a full `key` starting with `lfp_`
3. Alice `GET /api/v1/api-keys`
4. Assert: the key is listed; no entry includes the full `key`
5. Alice `DELETE /api/v1/api-keys/{id}`
6. Assert: 200; a second delete returns 404

### Scenario MCP02: Keys are private to their owner
1. Alice creates a key
2. Bob `DELETE /api/v1/api-keys/{alice's id}`
3. Assert: 404

### Scenario MCP03: Endpoint requires valid credentials
1. `POST /api/v1/mcp` with no Authorization → 401
2. With `Bearer lfp_notarealkey` → 401
3. With a valid key → 200
4. Revoke the key; same request → 401

### Scenario MCP04: Initialize and tool discovery
1. `initialize` with protocolVersion 2025-06-18
2. Assert: result echoes the version, `serverInfo.name` is `lefauxpain`, `instructions` names the acting user
3. `notifications/initialized` → HTTP 202, empty body
4. `tools/list`
5. Assert: `list_channels`, `read_messages`, `search_messages`, `send_message`, `list_users`, `list_documents`, `read_document` are present, each with an `inputSchema`
6. An unknown method returns JSON-RPC error `-32601`

### Scenario MCP05: send_message posts as the key owner and is broadcast
1. Bob connects over WS
2. Alice's key calls `send_message` with `#channel-name` and a unique marker
3. Assert: bob receives `message_create` with that content, authored by alice
4. `read_messages` by channel id includes the marker
5. `search_messages` for the marker finds it

### Scenario MCP06: send_message validation
1. Empty/whitespace content → tool error
2. 4001-character content → tool error
3. Unknown channel → tool error

### Scenario MCP07: Private channels are scoped per user
1. Admin creates a channel, sets visibility `invisible`, adds alice as member
2. Alice's key posts a secret word into it
3. Bob's key: `list_channels` omits the channel; `read_messages` errors without leaking content; `search_messages` for the secret returns nothing; `send_message` errors
4. Alice's key: `list_channels` includes it; `search_messages` finds the secret

### Scenario MCP08: Session tokens are accepted
1. `ping` with alice's session token → 200 with a result
2. `ping` with a random string → 401

### Scenario MCP09: No server-initiated stream
1. `GET /api/v1/mcp` with valid auth
2. Assert: 405

## Radio (validation: `validation/mcp_radio_test.go`)

Setup for R01-R06: alice's key creates a station and a playlist "Set A", then uploads two audio tracks (120s, 90s) over REST.

### Scenario R01: Create and inspect
1. `create_station` → result has `you_can_manage: true`
2. `create_playlist` on the station by name
3. `station_status` lists one playlist with two tracks and `playback: null`
4. `list_stations` includes the station

### Scenario R02: Playback round trip with a listener
1. Bob tunes to the station over WS
2. `radio_play` (no playlist) → playing track 1; bob receives `radio_playback` with `playing: true`
3. `radio_pause` → `playing: false`
4. `radio_seek` to 42 → position 42
5. `radio_resume` → `playing: true`
6. `radio_next` → track 2
7. `radio_stop` → `playback: "stopped"`; bob receives `radio_playback` with `stopped: true`
8. `radio_pause` on the idle station → tool error

### Scenario R03: Playback ACL
1. Bob's key: `radio_play`, `set_public_controls`, `set_station_mode` → tool errors
2. Alice enables public controls
3. Bob's key: `radio_play` → succeeds

### Scenario R04: Playback mode
1. `set_station_mode` with `shuffle` → tool error
2. `set_station_mode` `loop_one` → applied
3. Play, next, next → track index wraps to 0 instead of stopping

### Scenario R05: Reorder tracks
1. Partial id list → tool error
2. Full reversed list by playlist name → new order returned
3. Bob's key reordering alice's playlist → tool error

### Scenario R06: Name resolution
1. `station_status` by upper-cased name resolves to the same id
2. Unknown station → tool error
3. `create_station` with an existing name → tool error

### Scenario R07: Empty playlists
1. Station with an empty playlist: `radio_play` → "no playlist with tracks"
2. `radio_play` naming the empty playlist → "no tracks"

### Scenario R08: Discovery
1. `tools/list` includes all thirteen radio tools
