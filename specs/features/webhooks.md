# Feature: Webhook API for External Integrations

## Intent

Allow external systems (AI agents, bots, CI/CD pipelines, monitoring tools) to post messages to channels via a simple HTTP REST API, without needing a WebSocket connection or a user account login.

## Behavior

### Webhook Keys

Admins manage API keys for webhook access. Each key has a name for identification.

- Keys are 64-character hex strings with a `whk_` prefix (e.g., `whk_a1b2c3...`)
- Keys are generated server-side using cryptographic random bytes
- Keys are shown in full only once at creation time
- Listed keys are truncated for display (first 4 + last 4 characters)

### Incoming Webhook Endpoint

**POST /api/v1/webhooks/incoming**

External systems send messages by providing an API key and specifying a channel by name:

```
POST /api/v1/webhooks/incoming
X-Webhook-Key: whk_a1b2c3...
Content-Type: application/json

{
  "channel": "#lightover",
  "content": "Hello from an external system"
}
```

Behavior:
1. Validate the `X-Webhook-Key` header against the `webhook_keys` table
2. Strip `#` prefix from channel name if present
3. Look up channel by name (case-insensitive), must be a text channel, must not be deleted
4. Attribute the message to the "Lightover Agent" bot user
5. Create the message in the database
6. Broadcast `message_create` to all connected WebSocket clients
7. Return `201` with `{"id": "...", "channel_id": "...", "created_at": "..."}`

Error responses:
- `401` — missing or invalid API key
- `400` — missing content, missing channel, content exceeds 4000 chars, channel is not text type
- `404` — channel not found
- `429` — rate limit exceeded (10 requests/minute per IP)

### Bot User

Messages from webhooks are attributed to a system user:
- **Username:** "Lightover Agent"
- **ID:** `00000000-0000-0000-0000-000000000000`
- **Created lazily** on first webhook use (not at migration time, to avoid interfering with the first-user-is-admin logic which counts all rows in the users table)
- Cannot log in (no password hash)
- Approved but not admin
- Appears as a normal user in the message feed

### Admin Key Management

All endpoints require admin authentication via bearer token.

**GET /api/v1/admin/webhook-keys** — List all keys (keys truncated)
**POST /api/v1/admin/webhook-keys** — Create a new key. Body: `{"name": "key-name"}`. Returns full key (shown once).
**DELETE /api/v1/admin/webhook-keys/{id}** — Revoke a key by ID.

## Database

### webhook_keys table (Migration 20)

```sql
CREATE TABLE webhook_keys (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
);
```

## Files

| File | Purpose |
|------|---------|
| `server/db/migrations.go` | Migration 20: webhook_keys table |
| `server/db/webhooks.go` | WebhookKey CRUD, GetChannelByName, GetBotUser (lazy creation) |
| `server/api/webhooks.go` | WebhookHandler: Incoming, AdminListKeys, AdminCreateKey, AdminDeleteKey |
| `server/api/router.go` | Route registration with rate limiting |

## Rate Limiting

Webhook ingress is rate-limited at 10 requests per minute per IP, using the same `IPRateLimiter` mechanism as other endpoints. This prevents runaway external agents from flooding channels.

## Design Decisions

1. **API key auth (not bearer tokens):** Webhook callers are systems, not users. API keys are simpler and don't expire.
2. **Channel lookup by name (not ID):** External systems shouldn't need to know internal UUIDs. Channel names are human-readable.
3. **Lazy bot user creation:** Seeding the bot user in a migration caused the first real user to not receive admin status, since the app counts all users to detect the first registration. Creating the bot user on first webhook use avoids this.
4. **No attachments or mentions:** Webhooks send text-only messages. Attachments and @mentions are not supported in v1.
5. **No reply-to:** Webhook messages cannot be replies. The `ReplyTo` field is always nil.
