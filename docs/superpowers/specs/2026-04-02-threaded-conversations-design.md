# Threaded Conversations & Starred Messages — Design Spec

**Date:** 2026-04-02
**Product:** Le Faux Pain (GamersGuild)
**Status:** Approved for implementation

## Overview

Add threaded conversations and message starring to Le Faux Pain. Threads allow focused side-conversations without flooding the main channel feed. Stars are personal bookmarks for quick access to important messages and threads. A right-side slide-out panel provides the UI for both features.

## Design Principles

- Threads keep the main feed clean — reply chains don't clutter the channel
- Thread context is isolated — separate conversation histories per thread (critical for bot integration)
- Stars are personal — only you see your starred items
- Minimal schema changes — one column addition, one new table

---

## Data Model

### Messages Table Changes (Migration 22)

Add `thread_id` column to the existing messages table:

```sql
ALTER TABLE messages ADD COLUMN thread_id TEXT REFERENCES messages(id) ON DELETE SET NULL;
CREATE INDEX idx_messages_thread ON messages(thread_id, created_at ASC);
```

**Thread ID semantics:**
- `thread_id = NULL` — standalone message (no thread involvement)
- `thread_id = own id` — this message is a thread root
- `thread_id = another message's id` — this message is a reply within that thread

**Thread creation flow:**
1. User replies to message X (which has `thread_id = NULL`)
2. Server sets X's `thread_id = X.id` (X becomes a thread root)
3. Server sets the new reply's `thread_id = X.id`
4. All subsequent replies in the thread get `thread_id = X.id`
5. If user replies to a message that already has a `thread_id`, the new reply gets that same `thread_id` (replies stay in the same thread, no nesting)

### Starred Messages Table (Migration 22)

```sql
CREATE TABLE starred_messages (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, message_id)
);
CREATE INDEX idx_starred_user ON starred_messages(user_id, created_at DESC);
```

Stars are personal — each user has their own starred list. No visibility to other users.

### Backward Compatibility

Existing replies (pre-thread) have `thread_id = NULL` and continue to display inline with the `╭─` connector as they do now. Only new replies create threads. No data backfill.

---

## Main Feed Behavior

### Filtering

The message history query adds a filter to exclude thread replies:

```sql
WHERE (thread_id IS NULL OR thread_id = id)
```

This returns standalone messages and thread roots only. Thread replies are hidden from the main feed.

### Thread Indicator

Thread roots display a clickable indicator below the message:

```
[10:30 AM] Kalli: Let's work on the landing page copy
── 5 replies · last 2m ago
```

Clicking the indicator opens the thread panel.

### Thread Summary

Thread roots include summary data in the API response:

```json
{
  "id": "abc",
  "content": "Let's work on the landing page copy",
  "thread_id": "abc",
  "thread_summary": {
    "reply_count": 5,
    "last_reply_at": "2026-04-02T...",
    "last_reply_author": "KindlyQR_bot"
  }
}
```

Thread summaries are fetched in batch alongside message history to avoid N+1 queries.

---

## Thread Panel (Right Slide-out)

### Layout

- Slides in from the right, ~400px wide
- Header with tab switcher: **Thread** | **Starred**
- Close button (X) and Escape key to dismiss
- Main feed narrows to accommodate the panel

### Thread Tab

- Root message pinned at the top (doesn't scroll away)
- Thread replies below in chronological order (oldest first)
- Message input at the bottom — sends with `thread_id` set
- Real-time updates: new messages in the thread appear at the bottom via WebSocket
- Star button on the root message header

### Starred Tab

- List of all messages the user has starred, newest first
- Each item shows: author, content preview, timestamp
- Thread roots also show reply count
- Clicking a starred thread root switches to the Thread tab and loads that thread
- Clicking a starred standalone message scrolls to it in the main feed and closes the panel
- Unstar button on each item

### Opening the Panel

- Click "N replies" on a thread root → opens Thread tab
- Click star icon in the channel header → opens Starred tab
- Panel remembers which tab was last active

---

## API Endpoints

### Thread Messages

`GET /api/v1/channels/{channel_id}/threads/{thread_id}/messages`

Returns all messages in a thread ordered by `created_at ASC`. Supports `?before=` pagination for long threads. Response format matches existing message history.

### Stars (REST)

`POST /api/v1/stars/{message_id}` — Star a message. Returns 201.
`DELETE /api/v1/stars/{message_id}` — Unstar a message. Returns 200.
`GET /api/v1/stars` — List starred messages for the authenticated user, newest first. Returns message objects with thread summaries where applicable.

All star endpoints require bearer token authentication.

---

## WebSocket & Real-time

### Message Create Payload Changes

Add `thread_id` to both `SendMessageData` and `MessageCreatePayload`:

```go
type SendMessageData struct {
    ChannelID     string   `json:"channel_id"`
    Content       *string  `json:"content"`
    ReplyToID     *string  `json:"reply_to_id"`
    ThreadID      *string  `json:"thread_id"`
    AttachmentIDs []string `json:"attachment_ids"`
}

type MessageCreatePayload struct {
    ID          string              `json:"id"`
    ChannelID   string              `json:"channel_id"`
    ThreadID    *string             `json:"thread_id"`
    Author      UserPayload         `json:"author"`
    Content     *string             `json:"content"`
    ReplyTo     *ReplyToPayload     `json:"reply_to"`
    Attachments []AttachmentPayload `json:"attachments"`
    Mentions    []string            `json:"mentions"`
    CreatedAt   string              `json:"created_at"`
}
```

### Client-side Message Routing

When a `message_create` event arrives:
- `thread_id == NULL` → add to main feed (existing behavior)
- `thread_id == id` → add to main feed as thread root (show thread indicator)
- `thread_id != NULL && thread_id != id` → thread reply: do NOT add to main feed. If the thread panel is showing this thread, add the message there. Otherwise, update the thread root's reply count in the main feed.

### Thread Notifications

When someone replies in a thread, notify all thread participants (users who previously sent a message in that thread), except the reply author. New notification type `"thread_reply"`:

```json
{
  "type": "thread_reply",
  "data": {
    "thread_id": "msg-root-789",
    "channel_id": "ch-456",
    "channel_name": "kindlyqr",
    "message_id": "msg-123",
    "author_username": "KindlyQR_bot",
    "content_preview": "Here's the revised landing..."
  }
}
```

Thread participants are determined by: `SELECT DISTINCT author_id FROM messages WHERE thread_id = ? AND author_id IS NOT NULL`.

Clicking a thread notification opens the thread panel to that thread.

---

## Nanobot Integration

The Le Faux Pain channel plugin passes `thread_id` as `session_key` to nanobot:

```python
await self._handle_message(
    sender_id=author_id,
    chat_id=channel_id,
    content=content,
    session_key=thread_id or channel_id,
)
```

When the bot responds, the outbound message includes `thread_id` — so the response stays in the thread. Nanobot's agent loop already isolates conversation history by session key, so each thread gets independent context automatically.

Bot mentions in the main feed (no thread) use the channel_id as session key — existing behavior unchanged.

---

## Files Changed

### Server (Go)

| File | Change |
|------|--------|
| `server/db/migrations.go` | Migration 22: add `thread_id` to messages, create `starred_messages` table |
| `server/db/messages.go` | Add `GetThreadMessages()`, `GetThreadSummaries()`, update history query to filter thread replies |
| `server/db/stars.go` | New: `StarMessage()`, `UnstarMessage()`, `GetStarredMessages()` |
| `server/api/messages.go` | Add thread messages endpoint, include thread summaries in history response |
| `server/api/stars.go` | New: star/unstar/list REST handlers |
| `server/api/router.go` | Register thread and star routes |
| `server/ws/handlers.go` | Thread creation logic in `handleSendMessage`, thread participant notifications |
| `server/ws/protocol.go` | Add `ThreadID` to `SendMessageData` and `MessageCreatePayload` |

### Client (SolidJS)

| File | Change |
|------|--------|
| `client/src/stores/messages.ts` | Add `thread_id` to Message type, thread panel state signals |
| `client/src/lib/api.ts` | Add `getThreadMessages()`, `starMessage()`, `unstarMessage()`, `getStarredMessages()` |
| `client/src/lib/events.ts` | Route `message_create` by thread_id |
| `client/src/components/TextChannel/MessageList.tsx` | Filter thread replies, show thread indicator on roots |
| `client/src/components/TextChannel/ThreadPanel.tsx` | New: slide-out panel with Thread/Starred tabs |
| `client/src/components/TextChannel/ThreadIndicator.tsx` | New: "N replies · last Xm ago" component |
| `client/src/components/TextChannel/MessageInput.tsx` | Support sending with `thread_id` |

### Nanobot

| File | Change |
|------|--------|
| `kindlyqr_nano/lefauxpain.py` | Pass `thread_id` as session_key, include `thread_id` in outbound messages |

---

## Success Criteria

- Replying to a message in the main feed creates a thread — the reply appears only in the thread panel, not the main feed
- Thread roots show reply count and last activity in the main feed
- Thread panel opens from the right, shows full conversation, allows replying
- Stars are personal — each user manages their own starred list
- Starred tab shows all starred messages with quick navigation
- Bot mentions in threads get isolated conversation context
- Existing pre-thread replies continue to display inline (backward compatible)
- All existing validation scenarios pass unchanged
