# Feature: Mention Email for Inactive Users

## Intent

When a user is @-mentioned in a channel, the system creates an in-app notification and pushes it via WebSocket. If the user is offline, the notification waits in the database until they log in — but they have no way to know someone is trying to reach them.

This feature sends an email to mentioned users who haven't been active recently, so they know to come back and check the conversation.

## Current Behavior

1. User A sends a message mentioning User B (`<@user-b-id>`)
2. Server creates a `mention` notification in the DB
3. Server pushes `notification_create` via WebSocket to User B
4. If User B is online: they see it immediately
5. If User B is offline: notification sits in DB until next login. **No email is sent.**

## New Behavior

When a user is @-mentioned:

1. Existing notification flow continues unchanged (DB + WebSocket push)
2. Server checks: **is the mentioned user currently connected via WebSocket?**
3. If **yes**: do nothing extra (they'll see the in-app notification)
4. If **no**: check if the user has an email on file → send a mention notification email
5. Email send failure is **non-fatal** — log and continue

### Mention Email Content

- **Subject:** `"{AppName} — {AuthorUsername} mentioned you in #{ChannelName}"`
- **Body:** Contains the author's username, channel name, and a preview of the message content (same preview already built for in-app notifications). Tells the user they were mentioned and should check the conversation.
- **Format:** HTML and plain text versions, following the existing template style
- **No login link or token** — purely informational

### Rate Limiting

To prevent email spam when a user is away for an extended period:

- **Maximum 1 mention email per user per 3 days**
- After sending a mention email to a user, suppress further mention emails to that user for 72 hours
- This is tracked **in the database** (a `last_mention_email_at` column on the `users` table) so the cooldown survives server restarts
- The first mention while offline triggers an email immediately; the next one cannot be sent until 3 days later

### When the Email Is NOT Sent

- The mentioned user is currently online (has at least one active WebSocket connection)
- The mentioned user has no email address on file
- The mentioned user was already emailed about a mention within the last 3 days (rate limit)
- No email provider is configured
- The mentioning user is mentioning themselves (already filtered by existing code)

## Changes Required

### 1. Email Templates (`server/email/templates.go`)

Add two functions:

- `MentionEmailHTML(appName, authorUsername, channelName, contentPreview string) string`
- `MentionEmailText(appName, authorUsername, channelName, contentPreview string) string`

### 2. Provider Interface (`server/email/provider.go`)

Add to the `Provider` interface:

```go
SendMentionEmail(to, appName, authorUsername, channelName, contentPreview string) error
```

Add to `EmailService`:

```go
func (s *EmailService) SendMentionEmail(to, appName, authorUsername, channelName, contentPreview string) error
```

### 3. Provider Implementations

Implement `SendMentionEmail` on all three providers following the existing pattern.

### 4. Rate Limiting via Database (`server/db/users.go`)

Add a `last_mention_email_at` nullable DATETIME column to the `users` table (migration).

Add methods:

```go
func (d *DB) CanSendMentionEmail(userID string) (bool, error)
```

Returns `true` if `last_mention_email_at` is NULL or older than 72 hours. Comparison done in SQL.

```go
func (d *DB) SetMentionEmailSent(userID string) error
```

Sets `last_mention_email_at = datetime('now')` for the user.

### 5. WebSocket Hub — Online Check

The hub already tracks connected clients in `h.clients` (a map of `userID → []*Client`). Add a public method:

```go
func (h *Hub) IsUserOnline(userID string) bool
```

Returns `true` if `len(h.clients[userID]) > 0`. Protected by `h.mu.RLock()`.

### 6. Mention Handler (`server/ws/handlers.go`)

In `handleSendMessage`, in the existing loop that creates mention notifications (around line 224), after the notification is created and pushed via WebSocket:

```go
// Send mention email if user is offline
if !h.IsUserOnline(mentionedID) {
    mentionedUser, _ := h.DB.GetUserByID(mentionedID)
    if mentionedUser != nil && mentionedUser.Email != nil && *mentionedUser.Email != "" {
        go func(email, author, channel, preview string) {
            if err := h.EmailService.SendMentionEmail(email, "Le Faux Pain", author, channel, preview); err != nil {
                log.Printf("send mention email to %s: %v", email, err)
            }
        }(*mentionedUser.Email, c.User.Username, chName, preview)
    }
}
```

The email send happens in a goroutine so it does not block message delivery.

### 7. Hub Needs EmailService Reference

The `Hub` struct needs access to `EmailService`. Add it as a field, injected at startup — same pattern as how `Hub` already has access to `DB`.

## Database Changes

- Add `last_mention_email_at` nullable DATETIME column to the `users` table (migration)
- Online status is already tracked in-memory by the hub

## Constraints

- Must not slow down message delivery — email send is async (goroutine)
- Must not change the existing mention notification behavior (DB + WebSocket)
- Must respect the 1-email-per-3-days rate limit per user
- Must follow existing email patterns (template style, error handling, provider abstraction)
- Must only check WebSocket connectivity (not a `last_seen` DB column) to determine if a user is "offline"
- No client-side changes
- No new API endpoints

## Out of Scope

- Persisted `last_seen_at` column (the WebSocket hub's in-memory state is sufficient for "is the user online right now")
- Configurable rate limit threshold (hardcoded 1 hour is fine for now)
- Email notifications for thread replies (could be added later using the same pattern)
- User preferences for email notifications (e.g., "don't email me about mentions")
- Batching/digesting multiple mentions into a single email
- Unsubscribe links

## Resolved Decisions

1. **Online check, not "inactive for N days"** — simpler and more useful. If the user has a tab open, they'll see the notification. If not, they get an email. No need to track `last_seen_at` in the database.
2. **DB-persisted rate limiting** — 3 days is long enough that an in-memory map would be unreliable across server restarts. A single column on the users table is simple and durable.
3. **Goroutine for email send** — message delivery must not wait on email provider latency. Fire-and-forget with error logging.
4. **No user opt-out yet** — this is a small server for a known group. If opt-out is needed later, add a user setting.
