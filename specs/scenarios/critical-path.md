# Critical Path Scenarios

These scenarios describe the current working behavior of the system.
They are the safety net. If any of these fail after a change, the
change is wrong.

All scenarios describe **observable behavior** — what a user sends and
what they get back. No internal implementation details.

---

## Scenario 1: First user registers and becomes admin

The very first account created on a fresh server is auto-approved and
granted admin privileges. No approval step required.

### Steps
1. POST `/api/v1/auth/register` with `{ "username": "alice", "password": "secret123" }`
2. Assert: response status is **201**
3. Assert: response body contains `user` with `is_admin: true`
4. Assert: response body contains a `token` (non-empty string)
5. Assert: no `pending: true` field in response

---

## Scenario 2: Subsequent user registers and is held for approval

Every user after the first is pending until an admin approves them.

### Steps
1. Ensure at least one user already exists (the admin from Scenario 1)
2. POST `/api/v1/auth/register` with `{ "username": "bob", "password": "pass456" }`
3. Assert: response status is **202**
4. Assert: response body contains `{ "pending": true }`
5. Assert: response body does **not** contain a `token`
6. Assert: all online admins receive a WS event `notification_create` with
   `type: "pending_user"` and `data.username: "bob"`

---

## Scenario 3: Admin approves a pending user

Pending users cannot log in until approved. After approval they can.

### Steps
1. Register a pending user "bob" (Scenario 2)
2. Attempt POST `/api/v1/auth/login` with bob's credentials
3. Assert: response status is **403** with `{ "pending": true }`
4. As admin, POST `/api/v1/admin/users/{bob_id}/approve`
5. Assert: response status is **200** with `{ "status": "approved" }`
6. Assert: all connected clients receive WS event `user_approved` with
   `user.username: "bob"`
7. POST `/api/v1/auth/login` again with bob's credentials
8. Assert: response status is **200** with `user` and `token`

---

## Scenario 4: User logs in with valid credentials

### Steps
1. POST `/api/v1/auth/login` with known-good username and password
2. Assert: response status is **200**
3. Assert: response body contains `user` with `id`, `username`, `is_admin`
4. Assert: response body contains a `token`
5. Assert: the token can be used as a Bearer token for authenticated endpoints

---

## Scenario 5: User logs in with invalid credentials

### Steps
1. POST `/api/v1/auth/login` with wrong password (or nonexistent user)
2. Assert: response status is **401**
3. Assert: response body contains `"invalid credentials"`
4. Assert: no token is returned

---

## Scenario 6: WebSocket authenticates and receives ready state

After login, the client connects via WebSocket and receives the full
application state in a single `ready` event.

### Steps
1. Obtain a valid token (Scenario 4)
2. Connect to `/ws` (WebSocket upgrade)
3. Send `{ "op": "authenticate", "d": { "token": "<token>" } }`
4. Assert: server responds with `{ "op": "ready", "d": { ... } }`
5. Assert: `ready.user` contains the authenticated user's info
6. Assert: `ready.channels` is an array of channel objects
7. Assert: `ready.online_users` is an array that includes the current user
8. Assert: `ready.all_users` is an array of all approved users
9. Assert: `ready.voice_states` is an array (may be empty)
10. Assert: `ready.notifications` is an array (may be empty)
11. Assert: `ready.server_time` is a numeric Unix timestamp
12. Assert: all other connected users receive `user_online` with this user's info

---

## Scenario 7: WebSocket rejects invalid token

### Steps
1. Connect to `/ws`
2. Send `{ "op": "authenticate", "d": { "token": "bogus" } }`
3. Assert: server closes the connection (policy violation)
4. Assert: no `ready` event is received

---

## Scenario 8: User creates a text channel

### Steps
1. Authenticate via WS (Scenario 6)
2. Send `{ "op": "create_channel", "d": { "name": "general", "type": "text" } }`
3. Assert: all connected clients receive `channel_create` with
   `name: "general"`, `type: "text"`, and a generated `id`
4. Assert: `manager_ids` includes the creating user's ID
5. Assert: the channel appears in `GET /api/v1/channels` response

---

## Scenario 9: User sends a text message

### Steps
1. Authenticate via WS; create or select a text channel
2. Send `{ "op": "send_message", "d": { "channel_id": "<id>", "content": "Hello world!" } }`
3. Assert: all connected clients receive `message_create` with:
   - `content: "Hello world!"`
   - `channel_id` matching the target channel
   - `author.username` matching the sender
   - a generated `id` and `created_at` timestamp
4. Assert: the message appears in `GET /api/v1/channels/{id}/messages`

---

## Scenario 10: User replies to a message

### Steps
1. Send a message "Original" in a text channel (Scenario 9)
2. Note the message `id` from the `message_create` event
3. Send `{ "op": "send_message", "d": { "channel_id": "<id>", "content": "Reply!", "reply_to_id": "<original_id>" } }`
4. Assert: all clients receive `message_create` with:
   - `content: "Reply!"`
   - `reply_to.id` matching the original message ID
   - `reply_to.author` matching the original author
   - `reply_to.content: "Original"`

---

## Scenario 11: User edits a message

### Steps
1. Send a message "Typo" (Scenario 9); note the `id`
2. Send `{ "op": "edit_message", "d": { "message_id": "<id>", "content": "Fixed" } }`
3. Assert: all clients receive `message_update` with:
   - `id` matching the edited message
   - `content: "Fixed"`
   - `edited_at` is a non-null timestamp
4. Assert: fetching message history shows the updated content

---

## Scenario 12: User deletes a message

### Steps
1. Send a message (Scenario 9); note the `id`
2. Send `{ "op": "delete_message", "d": { "message_id": "<id>" } }`
3. Assert: all clients receive `message_delete` with `id` and `channel_id`
4. Assert: fetching message history shows the message with `deleted: true`

---

## Scenario 13: User adds and removes a reaction

### Steps
1. Send a message (Scenario 9); note the `id`
2. Send `{ "op": "add_reaction", "d": { "message_id": "<id>", "emoji": "👍" } }`
3. Assert: all clients receive `reaction_add` with
   `message_id`, `user_id`, `emoji: "👍"`
4. Send `{ "op": "remove_reaction", "d": { "message_id": "<id>", "emoji": "👍" } }`
5. Assert: all clients receive `reaction_remove` with
   `message_id`, `user_id`, `emoji: "👍"`

---

## Scenario 14: User mentions another user and they get notified

### Steps
1. Two users authenticated: Alice and Bob
2. Alice sends `{ "op": "send_message", "d": { "channel_id": "<id>", "content": "Hey <@bob_user_id> check this" } }`
3. Assert: Bob receives `notification_create` with:
   - `type: "mention"`
   - `data.author_username` matching Alice
   - `data.channel_id` matching the channel
   - `data.content_preview` containing the message text (up to 80 chars)
4. Assert: Alice does **not** receive a notification for mentioning herself
   (if she mentioned her own ID)

---

## Scenario 15: User uploads a file and attaches it to a message

### Steps
1. Authenticate via REST (obtain Bearer token)
2. POST `/api/v1/upload` with multipart form containing an image file
3. Assert: response status is **200**
4. Assert: response contains `id`, `url`, `filename`, `mime_type`
5. Assert: for images, response also contains `thumb_url`, `width`, `height`
6. Send via WS: `{ "op": "send_message", "d": { "channel_id": "<id>", "attachment_ids": ["<upload_id>"] } }`
7. Assert: `message_create` event includes `attachments` array with the
   uploaded file's info
8. Assert: the file is accessible via GET on the returned `url`

---

## Scenario 16: User joins a voice channel

### Steps
1. Create a voice channel: `{ "op": "create_channel", "d": { "name": "Voice", "type": "voice" } }`
2. Send `{ "op": "join_voice", "d": { "channel_id": "<voice_id>" } }`
3. Assert: all clients receive `voice_state_update` with
   `user_id` and `channel_id` matching the voice channel
4. Assert: server sends `webrtc_offer` (with SDP) directly to the joining user
5. Client responds: `{ "op": "webrtc_answer", "d": { "sdp": "<answer_sdp>" } }`
6. Assert: ICE candidates are exchanged via `webrtc_ice` in both directions

---

## Scenario 17: User leaves a voice channel

### Steps
1. Join a voice channel (Scenario 16)
2. Send `{ "op": "leave_voice", "d": {} }`
3. Assert: all clients receive `voice_state_update` with
   `user_id` and `channel_id: ""`  (empty string = no channel)

---

## Scenario 18: User mutes and deafens in voice

### Steps
1. Join a voice channel (Scenario 16)
2. Send `{ "op": "voice_self_mute", "d": { "muted": true } }`
3. Assert: all clients receive `voice_state_update` with `self_mute: true`
4. Send `{ "op": "voice_self_deafen", "d": { "deafened": true } }`
5. Assert: all clients receive `voice_state_update` with `self_deafen: true`

---

## Scenario 19: Voice state clears on disconnect

When a user disconnects (intentionally or not), their voice state is
cleaned up automatically.

### Steps
1. User joins a voice channel (Scenario 16)
2. User's WebSocket connection closes
3. Assert: all remaining clients receive `voice_state_update` with
   `user_id` and `channel_id: ""`
4. Assert: all remaining clients receive `user_offline` with the user's ID

---

## Scenario 20: Message history with cursor pagination

### Steps
1. Send 5+ messages in a text channel
2. GET `/api/v1/channels/{id}/messages?limit=2`
3. Assert: response contains exactly 2 messages (the most recent)
4. Note the `id` of the oldest message returned
5. GET `/api/v1/channels/{id}/messages?limit=2&before=<that_id>`
6. Assert: response contains the next 2 older messages
7. Assert: no message appears in both responses

---

## Scenario 21: Channel rename and deletion

### Steps
1. Create a text channel "old-name" (Scenario 8)
2. Send `{ "op": "rename_channel", "d": { "channel_id": "<id>", "name": "new-name" } }`
3. Assert: all clients receive `channel_update` with `name: "new-name"`
4. Send `{ "op": "delete_channel", "d": { "channel_id": "<id>" } }`
5. Assert: all clients receive `channel_delete` with `channel_id`
6. Assert: the channel no longer appears in `GET /api/v1/channels`

---

## Scenario 22: Admin restores a deleted channel

### Steps
1. Delete a channel (Scenario 21, step 4)
2. As admin, send `{ "op": "restore_channel", "d": { "channel_id": "<id>" } }`
3. Assert: all clients receive `channel_create` with the restored channel's info
4. Assert: the channel reappears in `GET /api/v1/channels`

---

## Scenario 23: Typing indicator broadcasts to others

### Steps
1. Two users in the same text channel: Alice and Bob
2. Alice sends `{ "op": "typing_start", "d": { "channel_id": "<id>" } }`
3. Assert: Bob receives `typing_start` with `channel_id` and `user_id: alice_id`
4. Assert: Alice does **not** receive her own `typing_start` event

---

## Scenario 24: Online/offline presence tracking

### Steps
1. Alice authenticates via WS
2. Bob authenticates via WS
3. Assert: Bob receives `user_online` with Alice's info (if Alice connected first),
   or Alice receives `user_online` with Bob's info
4. Assert: both users' `ready.online_users` includes all currently connected users
5. Alice disconnects
6. Assert: Bob receives `user_offline` with `user_id: alice_id`

---

## Scenario 25: Radio station lifecycle

### Steps
1. Authenticate via WS
2. Send `{ "op": "create_radio_station", "d": { "name": "Chill Beats" } }`
3. Assert: all clients receive `radio_station_create` with
   `name: "Chill Beats"` and `manager_ids` including the creator
4. Upload a track: POST `/api/v1/radio/playlists/{playlist_id}/tracks`
   with an audio file
5. Assert: response contains `id`, `filename`, `url`, `duration`
6. Send `{ "op": "radio_play", "d": { "station_id": "<id>", "playlist_id": "<pl_id>" } }`
7. Assert: all clients receive `radio_playback` with
   `playing: true`, `track_index: 0`, and `track` info
8. Send `{ "op": "radio_pause", "d": { "station_id": "<id>", "position": 30.0 } }`
9. Assert: all clients receive `radio_playback` with `playing: false`
10. Send `{ "op": "radio_stop", "d": { "station_id": "<id>" } }`
11. Assert: all clients receive `radio_playback` with `stopped: true`

---

## Scenario 26: Radio listener tracking

### Steps
1. A radio station exists with active playback
2. User sends `{ "op": "radio_tune", "d": { "station_id": "<id>" } }`
3. Assert: all clients receive `radio_listeners` with `user_ids` including this user
4. User sends `{ "op": "radio_untune" }`
5. Assert: all clients receive `radio_listeners` with `user_ids` no longer including this user
6. If user disconnects while tuned: assert `radio_listeners` update is broadcast
   removing them

---

## Scenario 27: Synchronized media playback

### Steps
1. Upload a video: POST `/api/v1/media/upload` with a video/mp4 file
2. Assert: all connected clients receive `media_added` with `id`, `filename`, `url`
3. Send via WS: `{ "op": "media_play", "d": { "video_id": "<id>", "position": 0 } }`
4. Assert: all clients receive `media_playback` with
   `video_id`, `playing: true`, `position: 0`
5. Send `{ "op": "media_pause", "d": { "position": 45.2 } }`
6. Assert: all clients receive `media_playback` with `playing: false`, `position: 45.2`
7. Send `{ "op": "media_stop" }`
8. Assert: all clients receive `media_playback` with value `null`

---

## Scenario 28: Admin manages users

### Steps
1. Authenticate as admin
2. GET `/api/v1/admin/users`
3. Assert: response contains all users with `id`, `username`, `is_admin`, `approved`
4. POST `/api/v1/admin/users/{user_id}/admin` with `{ "is_admin": true }`
5. Assert: response contains `{ "status": "updated", "is_admin": true }`
6. DELETE `/api/v1/admin/users/{user_id}`
7. Assert: response contains `{ "status": "deleted" }`
8. Assert: the deleted user's WS connection is forcibly closed

---

## Scenario 29: Channel reordering persists

### Steps
1. Create three channels: A, B, C
2. Send `{ "op": "reorder_channels", "d": { "channel_ids": ["<C>", "<A>", "<B>"] } }`
3. Assert: all clients receive `channel_reorder` with the new order
4. Reconnect (new WS session)
5. Assert: `ready.channels` reflects the reordered positions

---

## Scenario 30: Deleting a voice channel kicks all users in it

### Steps
1. Create a voice channel; two users join it
2. Admin sends `{ "op": "delete_channel", "d": { "channel_id": "<voice_id>" } }`
3. Assert: all clients receive `voice_state_update` for each user in the channel
   with `channel_id: ""`  (kicked from voice)
4. Assert: all clients receive `channel_delete`

---

## Scenario 31: Screen share start and stop

### Steps
1. User joins a voice channel (Scenario 16)
2. Send `{ "op": "screen_share_start", "d": {} }`
3. Assert: all clients receive `screen_share_started` with
   `user_id` and `channel_id`
4. Assert: server sends `webrtc_screen_offer` to the presenter
5. Another user sends `{ "op": "screen_share_subscribe", "d": { "channel_id": "<id>" } }`
6. Assert: that viewer receives `webrtc_screen_offer` with `role: "viewer"`
7. Presenter sends `{ "op": "screen_share_stop", "d": {} }`
8. Assert: all clients receive `screen_share_stopped`

---

## Scenario 32: Duplicate WebSocket connection kicks the old one

Only one WS connection per user is allowed. A new connection replaces the old.

### Steps
1. User authenticates on WS connection A
2. User authenticates on WS connection B (same token)
3. Assert: connection A is forcibly closed by the server
4. Assert: connection B receives `ready` and functions normally

---

## Scenario 33: Rate limiting on registration

### Steps
1. POST `/api/v1/auth/register` three times in rapid succession (< 1 minute)
2. Assert: first 3 requests succeed or return expected responses
3. POST a 4th time within the same minute
4. Assert: response status is **429** (Too Many Requests)

---

## Scenario 34: Password change flow

### Steps
1. Authenticate as a user who has a password set
2. POST `/api/v1/auth/password` with `{ "current_password": "old", "new_password": "new" }`
3. Assert: response contains `{ "status": "updated", "has_password": true }`
4. Log out and log back in with the old password
5. Assert: login fails (401)
6. Log in with the new password
7. Assert: login succeeds (200 with token)

---

## Scenario 35: Only message author can edit; author or admin can delete

### Steps
1. Alice sends a message
2. Bob attempts `edit_message` on Alice's message
3. Assert: edit fails (error response or no `message_update` broadcast)
4. Bob attempts `delete_message` on Alice's message
5. Assert: delete fails (Bob is not admin and not the author)
6. Admin attempts `delete_message` on Alice's message
7. Assert: delete succeeds — `message_delete` broadcast to all
