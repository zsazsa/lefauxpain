# Security Scenarios

These scenarios describe security properties that the application must enforce.
Each maps to a real attack vector identified in the codebase.

---

## Authentication & Tokens

### Scenario S01: Unauthenticated requests to protected REST endpoints
1. For each endpoint behind `authMW.Wrap` (channels, upload, media, admin, password, email, radio, audio):
2. Send request without `Authorization` header
3. Assert: 401 Unauthorized
4. Assert: response body contains only `{"error":"..."}`, no data

### Scenario S02: Unauthenticated WebSocket connections are rejected
1. Open WebSocket to `/ws`
2. Send a non-authenticate message (e.g. `send_message`)
3. Assert: connection is closed within 5 seconds
4. Send no message at all
5. Assert: connection is closed after 5-second auth timeout

### Scenario S03: Invalid tokens are rejected on REST and WebSocket
1. Send REST request with `Authorization: Bearer invalid-uuid`
2. Assert: 401 Unauthorized
3. Open WebSocket, send `{"op":"authenticate","d":{"token":"invalid-uuid"}}`
4. Assert: connection is closed with auth failure

### Scenario S04: Tokens are invalidated when user is deleted
1. Register user, obtain token
2. Admin deletes user
3. Send REST request with deleted user's token
4. Assert: 401 Unauthorized
5. Open WebSocket with deleted user's token
6. Assert: connection is rejected

### Scenario S05: Password change should invalidate existing tokens
1. Register user, obtain token A
2. Log in again, obtain token B
3. Change password using token A
4. Assert: token A no longer works (401)
5. Assert: token B no longer works (401)
6. Log in with new password, obtain token C
7. Assert: token C works

**Status: NOT ENFORCED — tokens are permanent. This scenario documents desired behavior.**

---

## Authorization & Access Control

### Scenario S06: Non-admin users cannot access admin endpoints
1. Register and approve a non-admin user
2. Attempt: `GET /api/v1/admin/users`
3. Assert: 403 Forbidden
4. Attempt: `POST /api/v1/admin/users/{id}/approve`
5. Assert: 403 Forbidden
6. Attempt: `POST /api/v1/admin/settings`
7. Assert: 403 Forbidden
8. Attempt: `POST /api/v1/admin/settings/email/test`
9. Assert: 403 Forbidden

### Scenario S07: Users can only delete their own messages
1. User A sends a message
2. User B attempts to delete User A's message via WS `delete_message`
3. Assert: error response, message not deleted
4. Admin attempts to delete User A's message
5. Assert: success (admins can delete any message)

### Scenario S08: Users can only edit their own messages
1. User A sends a message
2. User B attempts to edit User A's message via WS `edit_message`
3. Assert: error response, message not edited

### Scenario S09: Only admins can restore deleted channels
1. Admin creates and deletes a channel
2. Non-admin user attempts `restore_channel` via WS
3. Assert: error response
4. Admin attempts `restore_channel`
5. Assert: success

### Scenario S10: Only admins can server-mute users in voice
1. User A joins a voice channel
2. Non-admin User B attempts `voice_server_mute` on User A via WS
3. Assert: error response
4. Admin attempts `voice_server_mute` on User A
5. Assert: success

### Scenario S11: Any authenticated user can delete any media item
1. User A uploads a video via `POST /api/v1/media/upload`
2. User B sends `DELETE /api/v1/media/{id}` for User A's video
3. Assert: success (current behavior — no ownership check)

**Status: VULNERABILITY — media delete has no ownership check. This scenario documents the gap. Fix: require uploader or admin.**

### Scenario S12: Channel reorder has no permission check
1. Non-admin user sends `reorder_channels` via WS with a new channel order
2. Assert: channels are reordered (current behavior)

**Status: VULNERABILITY — any user can reorder all channels. Fix: require admin.**

### Scenario S13: Any user can control global media playback
1. Non-admin user sends `media_play` with an arbitrary video_id via WS
2. Assert: playback state is broadcast to all users (current behavior)

**Status: VULNERABILITY — no access control on media_play/pause/seek/stop. Fix: require admin or designated role.**

### Scenario S14: Any user can control any radio station playback
1. User A creates a radio station
2. Non-manager User B sends `radio_pause` for User A's station via WS
3. Assert: station is paused (current behavior)

**Status: VULNERABILITY — no station manager check on playback controls. Fix: require station manager or admin.**

---

## Rate Limiting

### Scenario S15: Login rate limiting enforced
1. Send 6 POST requests to `/api/v1/auth/login` within 1 minute from same IP
2. Assert: 6th request returns 429 Too Many Requests
3. Wait for window to expire
4. Assert: next request succeeds

### Scenario S16: Registration rate limiting enforced
1. Send 4 POST requests to `/api/v1/auth/register` within 1 minute from same IP
2. Assert: 4th request returns 429 Too Many Requests

### Scenario S17: Password reset rate limiting enforced
1. Send 6 POST requests to `/api/v1/auth/forgot` within 1 minute from same IP
2. Assert: 6th request returns 429 Too Many Requests

### Scenario S18: Rate limiter uses trusted IP, not spoofable header
1. Send requests to `/api/v1/auth/login` with varying `X-Forwarded-For` headers
2. Assert: rate limit is based on actual connection IP (`RemoteAddr` or trusted proxy header), NOT the raw `X-Forwarded-For` value

**Status: VULNERABILITY — rate limiter uses raw `X-Forwarded-For` as key. An attacker can set arbitrary values to bypass all IP-based rate limits. Fix: use `X-Real-IP` (set by nginx) or fall back to `RemoteAddr`, matching what `auth.go` already does for registration IP.**

### Scenario S19: WebSocket message rate limiting enforced
1. Open authenticated WebSocket connection
2. Send 31+ messages within 1 second
3. Assert: connection is dropped

### Scenario S20: Verification code attempt limiting
1. Request a verification code for a user
2. Submit 5 wrong codes
3. Assert: code is invalidated after 5 failed attempts
4. Assert: correct code no longer works after invalidation

### Scenario S21: Verification code resend rate limiting
1. Request 3 resend codes within 1 hour for same user
2. Assert: 4th resend request returns 429 Too Many Requests

---

## Input Validation

### Scenario S22: Username validation
1. Attempt registration with username `"; DROP TABLE users; --`
2. Assert: rejected by regex `^[a-zA-Z0-9_]{1,32}$`
3. Attempt registration with 33-character username
4. Assert: rejected
5. Attempt registration with empty username
6. Assert: rejected

### Scenario S23: Message content length limit
1. Send message with 4,001 characters via WS `send_message`
2. Assert: rejected (max 4,000 characters)
3. Send message with exactly 4,000 characters
4. Assert: accepted

### Scenario S24: Channel name validation
1. Create channel with 33-character name via WS
2. Assert: rejected (max 32 characters)
3. Create channel with empty name
4. Assert: rejected

### Scenario S25: Email format validation
1. Register with email `not-an-email`
2. Assert: rejected
3. Register with email `valid@example.com`
4. Assert: accepted

### Scenario S26: Knock message has no length limit
1. Register with a `knock_message` of 100,000 characters
2. Assert: accepted (current behavior — no limit)

**Status: VULNERABILITY — no length limit on knock_message. Fix: enforce max 500 characters (matching the frontend textarea maxLength).**

### Scenario S27: Waveform field has no length limit
1. Upload radio track with `waveform` field containing 1MB of data
2. Assert: accepted and stored in DB (current behavior)

**Status: VULNERABILITY — arbitrary-length string stored in DB. Fix: enforce reasonable max (e.g., 10,000 characters).**

### Scenario S28: Password length edge cases
1. Register with a 1-character password
2. Assert: accepted (current behavior — no minimum)
3. Register with a 100-character password
4. Assert: accepted
5. Log in with the first 72 characters of the 100-character password
6. Assert: succeeds (bcrypt truncates at 72 bytes)

**Status: WEAKNESS — no minimum password length and bcrypt silent truncation at 72 bytes. Fix: enforce minimum 8 characters, maximum 72 characters.**

---

## File Upload Security

### Scenario S29: Upload rejects non-image files
1. Upload a `.js` file to `POST /api/v1/upload`
2. Assert: rejected (only image/jpeg, image/png, image/gif, image/webp allowed)
3. Upload a `.exe` file
4. Assert: rejected

### Scenario S30: Upload enforces size limit
1. Upload a file larger than MaxUploadSize (default 10MB)
2. Assert: rejected with appropriate error

### Scenario S31: Media upload rejects non-video files
1. Upload a `.txt` file to `POST /api/v1/media/upload`
2. Assert: rejected (only video/mp4, video/webm allowed)

### Scenario S32: Radio track upload rejects non-audio files
1. Upload a `.html` file to `POST /api/v1/radio/playlists/{id}/tracks`
2. Assert: rejected

### Scenario S33: Uploaded files are not accessible by directory listing
1. Request `GET /uploads/`
2. Assert: 404 Not Found (no directory listing)
3. Request `GET /thumbs/`
4. Assert: 404 Not Found
5. Request `GET /avatars/`
6. Assert: 404 Not Found

### Scenario S34: Static upload paths require no auth but are unguessable
1. Upload an image, note the returned file path (SHA-256 hash-based)
2. Access the file without auth token via `GET /uploads/{hash-path}`
3. Assert: file is accessible (current behavior — content-addressed storage)
4. Attempt to access a non-existent hash path
5. Assert: 404

**Note: Files are publicly accessible if the URL is known. The SHA-256 content-addressed path makes guessing infeasible. This is acceptable for a self-hosted app but worth documenting.**

---

## Forgot Password / Reset Security

### Scenario S35: Forgot password does not leak user existence
1. Send `POST /api/v1/auth/forgot` with a registered email
2. Assert: 200 `{"status":"sent"}`
3. Send `POST /api/v1/auth/forgot` with an unregistered email
4. Assert: 200 `{"status":"sent"}` (same response)

### Scenario S36: Reset code expires after 15 minutes
1. Request a reset code
2. Expire the code (dev test endpoint or wait)
3. Attempt reset with the expired code
4. Assert: rejected with "code expired"

### Scenario S37: Reset code invalidated after 5 failed attempts
1. Request a reset code
2. Submit 5 wrong codes
3. Submit the correct code
4. Assert: rejected ("too many failed attempts")

### Scenario S38: Password reset works without email verification enabled
1. Disable email verification toggle
2. Configure an email provider
3. Register a user with an email
4. Request password reset
5. Assert: reset code is sent and reset flow works

### Scenario S39: Password reset requires email provider configured
1. Ensure no email provider is configured
2. Send `POST /api/v1/auth/forgot`
3. Assert: 400 "email is not configured on this server"

---

## Dev-Mode Endpoint Security

### Scenario S40: Test endpoints only available in dev mode
1. Start server WITHOUT `--dev` flag
2. Request `GET /api/v1/test/verification-code?email=test@example.com`
3. Assert: 404 Not Found
4. Request `GET /api/v1/test/raw-setting?key=email_provider_config`
5. Assert: 404 Not Found

### Scenario S41: Test endpoints are unauthenticated in dev mode
1. Start server WITH `--dev` flag
2. Request `GET /api/v1/test/verification-code?email=test@example.com` without auth
3. Assert: 200 (by design — dev only)

**Note: If `--dev` is accidentally enabled in production, these endpoints expose verification codes and raw settings (including encrypted API keys). The `make validate` Makefile uses `--dev` intentionally.**

---

## WebSocket Security

### Scenario S42: WebSocket auth timeout
1. Open WebSocket to `/ws`
2. Do not send any message
3. Assert: connection closed after 5 seconds

### Scenario S43: Duplicate WebSocket connections kick the old one
1. User authenticates via WebSocket (connection A)
2. User authenticates via WebSocket again (connection B)
3. Assert: connection A is closed with a "kicked" message
4. Assert: connection B remains active

### Scenario S44: SQL injection via WebSocket operations
1. Send `send_message` with content `'; DROP TABLE messages; --`
2. Assert: message is stored as literal text, no SQL error
3. Send `create_channel` with name `' OR 1=1 --`
4. Assert: channel created with literal name (parameterized queries prevent injection)

---

## File Storage Security

### Scenario S45: Path traversal via upload filename
1. Upload a file with filename `../../../etc/passwd`
2. Assert: file is stored under the SHA-256 hash path, not the original filename
3. Assert: no file written outside of `data-dir/uploads/`

### Scenario S46: Path traversal via static file serving
1. Request `GET /uploads/../../etc/passwd`
2. Assert: 404 or 400, not the contents of `/etc/passwd`
3. Request `GET /uploads/../data.db`
4. Assert: 404 or 400, database file not served

### Scenario S47: Upload disk exhaustion
1. Authenticated user uploads the maximum allowed file size repeatedly
2. Assert: rate limiting on upload endpoints (3/30s for images, 2/min for media) throttles repeated uploads
3. Assert: server does not crash when disk is full (graceful error)

**Note: There is no per-user storage quota. A malicious authenticated user could fill disk over time within rate limits. For a self-hosted app with approval-gated registration this is low risk, but a quota system would harden it.**

### Scenario S48: Deleted file cleanup
1. User uploads an attachment but never links it to a message
2. Assert: orphan cleanup goroutine removes the file after 1 hour
3. User sends a message with an attachment, then deletes the message
4. Assert: attachment file remains on disk (content-addressed dedup — other messages may reference same hash)

### Scenario S49: File deduplication does not leak existence
1. User A uploads image X (SHA-256 hash: abc123)
2. User B uploads the same image X
3. Assert: both uploads succeed, same file path returned
4. Assert: User B does not receive any indication that the file already existed from User A

**Note: Dedup is content-addressed — identical files map to identical paths. This is by design and does not leak user identity, only that the same content was uploaded before.**

### Scenario S50: RemoveFile cannot delete outside data directory
1. Call `RemoveFile` with a path containing `../../`
2. Assert: only files under `data-dir/` can be removed
3. Assert: `filepath.Join` normalizes the path, preventing traversal

**Note: `RemoveFile` uses `filepath.Join(fs.DataDir, relPath)` which normalizes `..` segments. A relative path like `../../etc/passwd` would resolve to a path under `DataDir`'s parent, but Go's `filepath.Join` with an absolute `DataDir` makes this safe as long as `DataDir` is absolute (which it is — set from CLI flag).**

---

## Summary of Confirmed Vulnerabilities

| ID | Severity | Issue | Current State |
|----|----------|-------|---------------|
| S05 | Medium | Tokens not invalidated on password change | Tokens are permanent |
| S11 | Medium | Any user can delete any media item | No ownership check |
| S12 | Low | Any user can reorder channels | No permission check |
| S13 | Medium | Any user can control global media playback | No access control |
| S14 | Medium | Any user can control any radio station | No manager check on playback |
| S18 | High | Rate limiter bypassable via X-Forwarded-For | Uses raw header as key |
| S26 | Low | knock_message has no server-side length limit | Frontend has 500 char max |
| S27 | Low | waveform field has no length limit | Arbitrary string in DB |
| S28 | Low | No password min length, bcrypt truncates at 72 | Silent truncation |
