# Threaded Conversations & Starred Messages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add threaded conversations and message starring to Le Faux Pain so replies happen in a focused side panel without flooding the main feed.

**Architecture:** Add `thread_id` column to messages table for thread grouping, `starred_messages` table for personal bookmarks. Thread replies are filtered from the main feed and shown in a right slide-out panel. Stars REST API. Thread participant notifications. Nanobot integration via session_key.

**Tech Stack:** Go (backend), SQLite, SolidJS (frontend), WebSocket, nanobot Python plugin

**Codebase:** `~/projects/GamersGuild/`

---

## File Structure

```
server/
├── db/
│   ├── migrations.go      (MODIFY: migration 22 — thread_id column + starred_messages table)
│   ├── messages.go         (MODIFY: add GetThreadMessages, GetThreadSummaries, update GetMessages filter)
│   └── stars.go            (CREATE: StarMessage, UnstarMessage, GetStarredMessages)
├── api/
│   ├── router.go           (MODIFY: register thread + star routes)
│   ├── messages.go         (MODIFY: include thread_summary in history, add thread messages handler)
│   └── stars.go            (CREATE: star/unstar/list handlers)
├── ws/
│   ├── protocol.go         (MODIFY: add ThreadID to SendMessageData + MessageCreatePayload)
│   └── handlers.go         (MODIFY: thread creation logic + thread participant notifications)

client/src/
├── stores/
│   └── messages.ts         (MODIFY: add thread_id to Message type, thread panel state)
├── lib/
│   ├── api.ts              (MODIFY: add thread + star API functions)
│   └── events.ts           (MODIFY: route message_create by thread_id)
├── components/TextChannel/
│   ├── MessageList.tsx      (MODIFY: filter thread replies, handle panel open)
│   ├── Message.tsx          (MODIFY: add thread indicator + star button)
│   ├── MessageInput.tsx     (MODIFY: support thread_id in send)
│   ├── ThreadPanel.tsx      (CREATE: slide-out panel with Thread/Starred tabs)
│   └── ThreadIndicator.tsx  (CREATE: "N replies · last Xm ago" component)

~/projects/kindlyqr_nano/
└── lefauxpain.py           (MODIFY: pass thread_id as session_key, include in outbound)
```

---

### Task 1: Database Migration — thread_id + starred_messages

**Files:**
- Modify: `~/projects/GamersGuild/server/db/migrations.go`

- [ ] **Step 1: Add migration 22 to the migrations slice**

In `~/projects/GamersGuild/server/db/migrations.go`, add before the closing `}` of the migrations slice:

```go
	// Version 22: Threaded conversations + starred messages
	`ALTER TABLE messages ADD COLUMN thread_id TEXT REFERENCES messages(id) ON DELETE SET NULL;
	CREATE INDEX idx_messages_thread ON messages(thread_id, created_at ASC);

	CREATE TABLE starred_messages (
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		created_at DATETIME DEFAULT (datetime('now')),
		PRIMARY KEY (user_id, message_id)
	);
	CREATE INDEX idx_starred_user ON starred_messages(user_id, created_at DESC);`,
```

- [ ] **Step 2: Verify compilation**

```bash
cd ~/projects/GamersGuild/server && go build ./...
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd ~/projects/GamersGuild
git add server/db/migrations.go
git commit -m "feat: add thread_id column and starred_messages table (migration 22)"
```

---

### Task 2: DB Layer — Thread Queries

**Files:**
- Modify: `~/projects/GamersGuild/server/db/messages.go`

- [ ] **Step 1: Add ThreadID to the Message struct**

In `~/projects/GamersGuild/server/db/messages.go`, find the `Message` struct (lines 8-17):

```go
type Message struct {
	ID        string  `json:"id"`
	ChannelID string  `json:"channel_id"`
	AuthorID  *string `json:"author_id"`
	Content   *string `json:"content"`
	ReplyToID *string `json:"reply_to_id"`
	CreatedAt string  `json:"created_at"`
	EditedAt  *string `json:"edited_at"`
	DeletedAt *string `json:"deleted_at"`
}
```

Add `ThreadID` field after `ReplyToID`:

```go
type Message struct {
	ID        string  `json:"id"`
	ChannelID string  `json:"channel_id"`
	AuthorID  *string `json:"author_id"`
	Content   *string `json:"content"`
	ReplyToID *string `json:"reply_to_id"`
	ThreadID  *string `json:"thread_id"`
	CreatedAt string  `json:"created_at"`
	EditedAt  *string `json:"edited_at"`
	DeletedAt *string `json:"deleted_at"`
}
```

- [ ] **Step 2: Update all existing queries that SELECT from messages to include thread_id**

Every query that scans into a `Message` struct needs to include `thread_id`. Update these functions:

**GetMessageByID** (lines 46-59) — add `thread_id` to SELECT and Scan:
```go
func (d *DB) GetMessageByID(id string) (*Message, error) {
	m := &Message{}
	err := d.QueryRow(
		`SELECT id, channel_id, author_id, content, reply_to_id, thread_id, created_at, edited_at, deleted_at
		 FROM messages WHERE id = ?`, id,
	).Scan(&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.ReplyToID, &m.ThreadID, &m.CreatedAt, &m.EditedAt, &m.DeletedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	return m, nil
}
```

**CreateMessage** (lines 34-44) — no change needed (it calls GetMessageByID which now includes thread_id).

**GetMessages** (lines 61-112) — add `thread_id` to SELECT and Scan, and add WHERE filter for main feed:
Find the SELECT query in GetMessages and add `thread_id` to the column list. Add `AND (thread_id IS NULL OR thread_id = messages.id)` to the WHERE clause. Update the Scan call to include `&m.ThreadID`.

**GetMessagesAround** (lines 114-177) — same changes: add `thread_id` to SELECT/Scan and the thread filter.

- [ ] **Step 3: Add SetThreadID function**

Add at the end of messages.go:

```go
// SetThreadID sets the thread_id for a message (used when a message becomes a thread root).
func (d *DB) SetThreadID(messageID string, threadID string) error {
	_, err := d.Exec(`UPDATE messages SET thread_id = ? WHERE id = ?`, threadID, messageID)
	if err != nil {
		return fmt.Errorf("set thread id: %w", err)
	}
	return nil
}
```

- [ ] **Step 4: Add GetThreadMessages function**

```go
// GetThreadMessages returns all messages in a thread, oldest first.
func (d *DB) GetThreadMessages(threadID string, limit int, before string) ([]Message, error) {
	var rows *sql.Rows
	var err error

	if before != "" {
		rows, err = d.Query(
			`SELECT id, channel_id, author_id, content, reply_to_id, thread_id, created_at, edited_at, deleted_at
			 FROM messages
			 WHERE thread_id = ? AND deleted_at IS NULL AND created_at < (SELECT created_at FROM messages WHERE id = ?)
			 ORDER BY created_at ASC
			 LIMIT ?`,
			threadID, before, limit,
		)
	} else {
		rows, err = d.Query(
			`SELECT id, channel_id, author_id, content, reply_to_id, thread_id, created_at, edited_at, deleted_at
			 FROM messages
			 WHERE thread_id = ? AND deleted_at IS NULL
			 ORDER BY created_at ASC
			 LIMIT ?`,
			threadID, limit,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("get thread messages: %w", err)
	}
	defer rows.Close()

	var msgs []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.ReplyToID, &m.ThreadID, &m.CreatedAt, &m.EditedAt, &m.DeletedAt); err != nil {
			return nil, fmt.Errorf("scan thread message: %w", err)
		}
		msgs = append(msgs, m)
	}
	return msgs, nil
}
```

- [ ] **Step 5: Add GetThreadSummaries function**

```go
// ThreadSummary holds reply count and last activity for a thread root.
type ThreadSummary struct {
	ThreadID        string `json:"thread_id"`
	ReplyCount      int    `json:"reply_count"`
	LastReplyAt     string `json:"last_reply_at"`
	LastReplyAuthor string `json:"last_reply_author"`
}

// GetThreadSummaries returns summaries for the given thread IDs.
func (d *DB) GetThreadSummaries(threadIDs []string) (map[string]ThreadSummary, error) {
	if len(threadIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(threadIDs))
	args := make([]any, len(threadIDs))
	for i, id := range threadIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`
		SELECT m.thread_id, COUNT(*) - 1 as reply_count, MAX(m.created_at) as last_reply_at,
			COALESCE((SELECT u.username FROM messages m2 JOIN users u ON m2.author_id = u.id
				WHERE m2.thread_id = m.thread_id AND m2.deleted_at IS NULL
				ORDER BY m2.created_at DESC LIMIT 1), '') as last_reply_author
		FROM messages m
		WHERE m.thread_id IN (%s) AND m.deleted_at IS NULL
		GROUP BY m.thread_id
		HAVING reply_count > 0
	`, strings.Join(placeholders, ","))

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("get thread summaries: %w", err)
	}
	defer rows.Close()

	summaries := make(map[string]ThreadSummary)
	for rows.Next() {
		var s ThreadSummary
		if err := rows.Scan(&s.ThreadID, &s.ReplyCount, &s.LastReplyAt, &s.LastReplyAuthor); err != nil {
			return nil, fmt.Errorf("scan thread summary: %w", err)
		}
		summaries[s.ThreadID] = s
	}
	return summaries, nil
}
```

- [ ] **Step 6: Add GetThreadParticipants function**

```go
// GetThreadParticipants returns user IDs of everyone who has posted in a thread.
func (d *DB) GetThreadParticipants(threadID string) ([]string, error) {
	rows, err := d.Query(
		`SELECT DISTINCT author_id FROM messages WHERE thread_id = ? AND author_id IS NOT NULL AND deleted_at IS NULL`,
		threadID,
	)
	if err != nil {
		return nil, fmt.Errorf("get thread participants: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan thread participant: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, nil
}
```

- [ ] **Step 7: Add `strings` import if not already present**

Check the imports at the top of messages.go. Add `"strings"` if not already imported (needed for `strings.Join` in GetThreadSummaries).

- [ ] **Step 8: Verify compilation**

```bash
cd ~/projects/GamersGuild/server && go build ./...
```

- [ ] **Step 9: Commit**

```bash
cd ~/projects/GamersGuild
git add server/db/messages.go
git commit -m "feat: add thread queries — GetThreadMessages, GetThreadSummaries, GetThreadParticipants"
```

---

### Task 3: DB Layer — Stars

**Files:**
- Create: `~/projects/GamersGuild/server/db/stars.go`

- [ ] **Step 1: Create stars.go**

Create `~/projects/GamersGuild/server/db/stars.go`:

```go
package db

import (
	"database/sql"
	"fmt"
)

// StarMessage stars a message for a user. Idempotent.
func (d *DB) StarMessage(userID, messageID string) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO starred_messages (user_id, message_id) VALUES (?, ?)`,
		userID, messageID,
	)
	if err != nil {
		return fmt.Errorf("star message: %w", err)
	}
	return nil
}

// UnstarMessage removes a star. Returns error if not found.
func (d *DB) UnstarMessage(userID, messageID string) error {
	result, err := d.Exec(
		`DELETE FROM starred_messages WHERE user_id = ? AND message_id = ?`,
		userID, messageID,
	)
	if err != nil {
		return fmt.Errorf("unstar message: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("star not found")
	}
	return nil
}

// StarredMessage is a message with its star timestamp.
type StarredMessage struct {
	Message
	StarredAt     string  `json:"starred_at"`
	AuthorUsername string  `json:"author_username"`
}

// GetStarredMessages returns all starred messages for a user, newest stars first.
func (d *DB) GetStarredMessages(userID string) ([]StarredMessage, error) {
	rows, err := d.Query(
		`SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to_id, m.thread_id,
				m.created_at, m.edited_at, m.deleted_at,
				s.created_at as starred_at,
				COALESCE(u.username, '') as author_username
		 FROM starred_messages s
		 JOIN messages m ON s.message_id = m.id
		 LEFT JOIN users u ON m.author_id = u.id
		 WHERE s.user_id = ?
		 ORDER BY s.created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get starred messages: %w", err)
	}
	defer rows.Close()

	var msgs []StarredMessage
	for rows.Next() {
		var sm StarredMessage
		if err := rows.Scan(
			&sm.ID, &sm.ChannelID, &sm.AuthorID, &sm.Content, &sm.ReplyToID, &sm.ThreadID,
			&sm.CreatedAt, &sm.EditedAt, &sm.DeletedAt,
			&sm.StarredAt, &sm.AuthorUsername,
		); err != nil {
			return nil, fmt.Errorf("scan starred message: %w", err)
		}
		msgs = append(msgs, sm)
	}
	return msgs, nil
}

// IsStarred checks if a specific message is starred by a user.
func (d *DB) IsStarred(userID, messageID string) (bool, error) {
	var count int
	err := d.QueryRow(
		`SELECT COUNT(*) FROM starred_messages WHERE user_id = ? AND message_id = ?`,
		userID, messageID,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check starred: %w", err)
	}
	return count > 0, nil
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd ~/projects/GamersGuild/server && go build ./...
```

- [ ] **Step 3: Commit**

```bash
cd ~/projects/GamersGuild
git add server/db/stars.go
git commit -m "feat: add starred messages DB layer"
```

---

### Task 4: WebSocket Protocol — Add ThreadID

**Files:**
- Modify: `~/projects/GamersGuild/server/ws/handlers.go`

- [ ] **Step 1: Add ThreadID to SendMessageData**

In `~/projects/GamersGuild/server/ws/handlers.go`, find `SendMessageData` (lines 17-22):

```go
type SendMessageData struct {
	ChannelID     string   `json:"channel_id"`
	Content       *string  `json:"content"`
	ReplyToID     *string  `json:"reply_to_id"`
	AttachmentIDs []string `json:"attachment_ids"`
}
```

Add `ThreadID`:

```go
type SendMessageData struct {
	ChannelID     string   `json:"channel_id"`
	Content       *string  `json:"content"`
	ReplyToID     *string  `json:"reply_to_id"`
	ThreadID      *string  `json:"thread_id"`
	AttachmentIDs []string `json:"attachment_ids"`
}
```

- [ ] **Step 2: Add ThreadID to MessageCreatePayload**

Find `MessageCreatePayload` (lines 57-66):

```go
type MessageCreatePayload struct {
	ID          string              `json:"id"`
	ChannelID   string              `json:"channel_id"`
	Author      UserPayload         `json:"author"`
	Content     *string             `json:"content"`
	ReplyTo     *ReplyToPayload     `json:"reply_to"`
	Attachments []AttachmentPayload `json:"attachments"`
	Mentions    []string            `json:"mentions"`
	CreatedAt   string              `json:"created_at"`
}
```

Add `ThreadID`:

```go
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

- [ ] **Step 3: Add thread creation logic to handleSendMessage**

In the `handleSendMessage` function, after the message is created in the DB (after line 168), add thread logic:

Find this block:
```go
	msg, err := h.DB.CreateMessage(msgID, d.ChannelID, c.UserID, d.Content, d.ReplyToID)
	if err != nil {
		log.Printf("create message: %v", err)
		return
	}
```

Add thread logic immediately after:

```go
	// Thread logic: determine thread_id for this message
	var threadID *string
	if d.ThreadID != nil {
		// Explicit thread_id from client (replying within thread panel)
		threadID = d.ThreadID
		h.DB.SetThreadID(msgID, *d.ThreadID)
	} else if d.ReplyToID != nil {
		// Replying from main feed — create or join a thread
		parent, _ := h.DB.GetMessageByID(*d.ReplyToID)
		if parent != nil {
			if parent.ThreadID != nil {
				// Parent is already in a thread — join it
				threadID = parent.ThreadID
			} else {
				// Parent has no thread — make it a thread root
				h.DB.SetThreadID(parent.ID, parent.ID)
				tid := parent.ID
				threadID = &tid
			}
			h.DB.SetThreadID(msgID, *threadID)
		}
	}
```

- [ ] **Step 4: Add thread_id to the broadcast payload**

Find the broadcast construction (around line 283):

```go
	broadcast, _ := NewMessage("message_create", MessageCreatePayload{
		ID:        msg.ID,
		ChannelID: msg.ChannelID,
		Author: UserPayload{
			ID:       c.User.ID,
			Username: c.User.Username,
		},
		Content:     msg.Content,
		ReplyTo:     replyTo,
		Attachments: attachPayloads,
		Mentions:    mentionIDs,
		CreatedAt:   msg.CreatedAt,
	})
```

Add `ThreadID`:

```go
	broadcast, _ := NewMessage("message_create", MessageCreatePayload{
		ID:        msg.ID,
		ChannelID: msg.ChannelID,
		ThreadID:  threadID,
		Author: UserPayload{
			ID:       c.User.ID,
			Username: c.User.Username,
		},
		Content:     msg.Content,
		ReplyTo:     replyTo,
		Attachments: attachPayloads,
		Mentions:    mentionIDs,
		CreatedAt:   msg.CreatedAt,
	})
```

- [ ] **Step 5: Add thread participant notifications**

After the broadcast (after `h.BroadcastAll(broadcast)`), add thread notification logic:

```go
	// Notify thread participants (except the sender)
	if threadID != nil {
		participants, _ := h.DB.GetThreadParticipants(*threadID)
		for _, participantID := range participants {
			if participantID == c.UserID {
				continue
			}
			// Don't double-notify users already notified via mentions
			alreadyNotified := false
			for _, mentionedID := range mentionIDs {
				if mentionedID == participantID {
					alreadyNotified = true
					break
				}
			}
			if alreadyNotified {
				continue
			}

			chName := ""
			if ch != nil {
				chName = ch.Name
			}
			var preview string
			if d.Content != nil {
				preview = *d.Content
				if len(preview) > 80 {
					preview = preview[:80] + "..."
				}
			}

			notifID := uuid.New().String()
			notifData := map[string]any{
				"thread_id":       *threadID,
				"channel_id":      d.ChannelID,
				"channel_name":    chName,
				"message_id":      msgID,
				"author_username": c.User.Username,
				"content_preview": preview,
			}
			if err := h.DB.CreateNotification(notifID, participantID, "thread_reply", notifData); err != nil {
				log.Printf("create thread notification: %v", err)
				continue
			}
			dataJSON, _ := json.Marshal(notifData)
			notifMsg, _ := NewMessage("notification_create", NotificationPayload{
				ID:        notifID,
				Type:      "thread_reply",
				Data:      dataJSON,
				Read:      false,
				CreatedAt: msg.CreatedAt,
			})
			h.SendTo(participantID, notifMsg)
		}
	}
```

- [ ] **Step 6: Verify compilation**

```bash
cd ~/projects/GamersGuild/server && go build ./...
```

- [ ] **Step 7: Commit**

```bash
cd ~/projects/GamersGuild
git add server/ws/handlers.go
git commit -m "feat: add thread creation logic and participant notifications to WebSocket handler"
```

---

### Task 5: API — Thread Messages Endpoint + Stars Handlers

**Files:**
- Modify: `~/projects/GamersGuild/server/api/messages.go`
- Create: `~/projects/GamersGuild/server/api/stars.go`
- Modify: `~/projects/GamersGuild/server/api/router.go`

- [ ] **Step 1: Add thread_summary to message history response**

In `~/projects/GamersGuild/server/api/messages.go`, add a `threadSummaryPayload` struct near the other response structs (after line 48):

```go
type threadSummaryPayload struct {
	ReplyCount      int    `json:"reply_count"`
	LastReplyAt     string `json:"last_reply_at"`
	LastReplyAuthor string `json:"last_reply_author"`
}
```

Add `ThreadID` and `ThreadSummary` to the `messageResponse` struct (around line 22):

Find:
```go
type messageResponse struct {
```

Add two fields to it:
```go
	ThreadID      *string                `json:"thread_id"`
	ThreadSummary *threadSummaryPayload  `json:"thread_summary,omitempty"`
```

- [ ] **Step 2: Populate thread_id and thread_summary in GetHistory**

In the GetHistory handler, after messages are fetched from DB, collect thread IDs and fetch summaries in batch. In the response building loop, set `ThreadID` and `ThreadSummary` on each message.

After fetching messages from DB (after the `h.DB.GetMessages` or `h.DB.GetMessagesAround` calls), add:

```go
	// Collect thread IDs for summary lookup
	var threadIDs []string
	for _, m := range msgs {
		if m.ThreadID != nil && *m.ThreadID == m.ID {
			threadIDs = append(threadIDs, m.ID)
		}
	}
	threadSummaries, _ := h.DB.GetThreadSummaries(threadIDs)
```

Then in the response building loop where `messageResponse` is constructed, add:

```go
	resp.ThreadID = m.ThreadID
	if m.ThreadID != nil && *m.ThreadID == m.ID {
		if ts, ok := threadSummaries[m.ID]; ok {
			resp.ThreadSummary = &threadSummaryPayload{
				ReplyCount:      ts.ReplyCount,
				LastReplyAt:     ts.LastReplyAt,
				LastReplyAuthor: ts.LastReplyAuthor,
			}
		}
	}
```

- [ ] **Step 3: Add GetThreadHistory handler**

Add a new handler method to `MessageHandler` at the end of messages.go:

```go
// GetThreadHistory handles GET /api/v1/channels/{channelId}/threads/{threadId}/messages
func (h *MessageHandler) GetThreadHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Parse thread ID from path: /api/v1/channels/{channelId}/threads/{threadId}/messages
	parts := strings.Split(r.URL.Path, "/")
	// Expected: ["", "api", "v1", "channels", channelId, "threads", threadId, "messages"]
	if len(parts) < 8 {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	threadID := parts[6]

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	before := r.URL.Query().Get("before")

	msgs, err := h.DB.GetThreadMessages(threadID, limit, before)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Build response with author info, attachments, etc.
	msgIDs := make([]string, len(msgs))
	for i, m := range msgs {
		msgIDs[i] = m.ID
	}

	attachmentsByMsg, _ := h.DB.GetAttachmentsByMessageIDs(msgIDs)
	reactionsByMsg, _ := h.DB.GetReactionsByMessageIDs(msgIDs)
	mentionsByMsg, _ := h.DB.GetMentionsByMessageIDs(msgIDs)
	unfurlsByMsg, _ := h.DB.GetUnfurlsByMessageIDs(msgIDs)

	var response []messageResponse
	for _, m := range msgs {
		authorID := ""
		if m.AuthorID != nil {
			authorID = *m.AuthorID
		}
		author, _ := h.DB.GetUserByID(authorID)
		authorP := authorPayload{ID: authorID}
		if author != nil {
			authorP.Username = author.Username
			authorP.AvatarURL = author.AvatarURL
		}

		var reply *replyPayload
		if m.ReplyToID != nil {
			rc, _ := h.DB.GetReplyContext(*m.ReplyToID)
			if rc != nil {
				rcAuthorID := ""
				if rc.AuthorID != nil {
					rcAuthorID = *rc.AuthorID
				}
				reply = &replyPayload{
					ID:      rc.ID,
					Author:  authorPayload{ID: rcAuthorID, Username: rc.AuthorUsername},
					Content: rc.Content,
					Deleted: rc.DeletedAt != nil,
				}
			}
		}

		atts := attachmentsByMsg[m.ID]
		if atts == nil {
			atts = []attachmentResponse{}
		}
		reacts := reactionsByMsg[m.ID]
		if reacts == nil {
			reacts = []reactionResponse{}
		}
		mentions := mentionsByMsg[m.ID]
		if mentions == nil {
			mentions = []string{}
		}
		unfurls := unfurlsByMsg[m.ID]

		resp := messageResponse{
			ID:          m.ID,
			Author:      authorP,
			Content:     m.Content,
			ReplyTo:     reply,
			ThreadID:    m.ThreadID,
			Attachments: atts,
			Reactions:   reacts,
			Mentions:    mentions,
			Unfurls:     unfurls,
			CreatedAt:   m.CreatedAt,
			EditedAt:    m.EditedAt,
		}
		response = append(response, resp)
	}

	if response == nil {
		response = []messageResponse{}
	}
	writeJSON(w, http.StatusOK, response)
}
```

Add `"strconv"` and `"strings"` to the imports if not already present.

- [ ] **Step 4: Create stars.go API handler**

Create `~/projects/GamersGuild/server/api/stars.go`:

```go
package api

import (
	"net/http"
	"strings"

	"github.com/kalman/voicechat/db"
)

type StarsHandler struct {
	DB *db.DB
}

// Star handles POST /api/v1/stars/{messageId}
func (h *StarsHandler) Star(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		writeError(w, http.StatusBadRequest, "missing message ID")
		return
	}
	messageID := parts[len(parts)-1]

	if err := h.DB.StarMessage(user.ID, messageID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to star message")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{"status": "starred"})
}

// Unstar handles DELETE /api/v1/stars/{messageId}
func (h *StarsHandler) Unstar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		writeError(w, http.StatusBadRequest, "missing message ID")
		return
	}
	messageID := parts[len(parts)-1]

	if err := h.DB.UnstarMessage(user.ID, messageID); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "star not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to unstar message")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "unstarred"})
}

// List handles GET /api/v1/stars
func (h *StarsHandler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	msgs, err := h.DB.GetStarredMessages(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get starred messages")
		return
	}

	if msgs == nil {
		msgs = []db.StarredMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}
```

- [ ] **Step 5: Register routes in router.go**

In `~/projects/GamersGuild/server/api/router.go`, add handler initialization and routes.

After the `messageHandler` initialization (around line 26), add:

```go
	starsHandler := &StarsHandler{DB: database}
```

After the channel routes block (after line 63), add:

```go
	// Thread messages (authenticated)
	// Matches: /api/v1/channels/{id}/threads/{threadId}/messages
	mux.HandleFunc("/api/v1/channels/", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if strings.HasSuffix(path, "/messages") {
			if strings.Contains(path, "/threads/") {
				messageHandler.GetThreadHistory(w, r)
			} else {
				messageHandler.GetHistory(w, r)
			}
			return
		}
		http.NotFound(w, r)
	}))
```

Wait — this would conflict with the existing `/api/v1/channels/` route. The existing handler already matches this prefix. We need to modify the existing handler instead. Find the existing handler (lines 57-63):

```go
	mux.HandleFunc("/api/v1/channels/", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/messages") {
			messageHandler.GetHistory(w, r)
			return
		}
		http.NotFound(w, r)
	}))
```

Replace with:

```go
	mux.HandleFunc("/api/v1/channels/", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/messages") {
			if strings.Contains(r.URL.Path, "/threads/") {
				messageHandler.GetThreadHistory(w, r)
			} else {
				messageHandler.GetHistory(w, r)
			}
			return
		}
		http.NotFound(w, r)
	}))
```

Add star routes after the webhook routes:

```go
	// Stars (authenticated)
	mux.HandleFunc("/api/v1/stars", authMW.Wrap(starsHandler.List))
	mux.HandleFunc("/api/v1/stars/", authMW.Wrap(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			starsHandler.Star(w, r)
		case http.MethodDelete:
			starsHandler.Unstar(w, r)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	}))
```

- [ ] **Step 6: Verify compilation**

```bash
cd ~/projects/GamersGuild/server && go build ./...
```

- [ ] **Step 7: Commit**

```bash
cd ~/projects/GamersGuild
git add server/api/messages.go server/api/stars.go server/api/router.go
git commit -m "feat: add thread messages endpoint and stars REST API"
```

---

### Task 6: Frontend — Types, API, and Event Routing

**Files:**
- Modify: `~/projects/GamersGuild/client/src/stores/messages.ts`
- Modify: `~/projects/GamersGuild/client/src/lib/api.ts`
- Modify: `~/projects/GamersGuild/client/src/lib/events.ts`

- [ ] **Step 1: Add thread_id to Message type and thread panel state**

In `~/projects/GamersGuild/client/src/stores/messages.ts`, add `thread_id` to the Message type (around line 33):

Find `reply_to: ReplyTo | null;` and add after it:
```typescript
  thread_id: string | null;
  thread_summary?: {
    reply_count: number;
    last_reply_at: string;
    last_reply_author: string;
  } | null;
```

Add thread panel state signals after the existing exports (after `scrollToMessageId`):

```typescript
// Thread panel state
const [threadPanelOpen, setThreadPanelOpen] = createSignal(false);
const [activeThreadId, setActiveThreadId] = createSignal<string | null>(null);
const [threadMessages, setThreadMessages] = createSignal<Message[]>([]);
const [threadPanelTab, setThreadPanelTab] = createSignal<"thread" | "starred">("thread");

export {
  threadPanelOpen, setThreadPanelOpen,
  activeThreadId, setActiveThreadId,
  threadMessages, setThreadMessages,
  threadPanelTab, setThreadPanelTab,
};

export function addThreadMessage(msg: Message) {
  if (msg.thread_id === activeThreadId()) {
    setThreadMessages((prev) => [...prev, msg]);
  }
}

export function openThread(threadId: string) {
  setActiveThreadId(threadId);
  setThreadPanelTab("thread");
  setThreadPanelOpen(true);
}
```

- [ ] **Step 2: Add API functions**

In `~/projects/GamersGuild/client/src/lib/api.ts`, add at the end:

```typescript
export function getThreadMessages(channelId: string, threadId: string, before?: string) {
  const params = new URLSearchParams({ limit: "100" });
  if (before) params.set("before", before);
  return request(`/channels/${channelId}/threads/${threadId}/messages?${params}`);
}

export function starMessage(messageId: string) {
  return request(`/stars/${messageId}`, { method: "POST" });
}

export function unstarMessage(messageId: string) {
  return request(`/stars/${messageId}`, { method: "DELETE" });
}

export function getStarredMessages(): Promise<any[]> {
  return request("/stars");
}
```

- [ ] **Step 3: Update message_create event routing**

In `~/projects/GamersGuild/client/src/lib/events.ts`, find the `message_create` handler (around line 203):

```typescript
case "message_create":
  addMessage({
    ...msg.d,
    reactions: msg.d.reactions || [],
    mentions: msg.d.mentions || [],
    attachments: msg.d.attachments || [],
    edited_at: null,
  });
  mergeKnownUsers([msg.d.author]);
  break;
```

Replace with:

```typescript
case "message_create": {
  const newMsg = {
    ...msg.d,
    reactions: msg.d.reactions || [],
    mentions: msg.d.mentions || [],
    attachments: msg.d.attachments || [],
    edited_at: null,
  };
  mergeKnownUsers([msg.d.author]);

  const threadId = msg.d.thread_id;
  if (threadId && threadId !== msg.d.id) {
    // Thread reply — don't add to main feed, add to thread panel if open
    addThreadMessage(newMsg);
    // Update thread root's summary in main feed
    updateThreadSummary(msg.d.channel_id, threadId, msg.d.author.username);
  } else {
    // Standalone message or thread root — add to main feed
    addMessage(newMsg);
  }
  break;
}
```

Add imports at the top of events.ts:

```typescript
import { addThreadMessage } from "../stores/messages";
```

Add the `updateThreadSummary` helper to `stores/messages.ts`:

```typescript
export function updateThreadSummary(channelId: string, threadId: string, authorUsername: string) {
  const msgs = messagesByChannel[channelId];
  if (!msgs) return;
  const idx = msgs.findIndex((m) => m.id === threadId);
  if (idx === -1) return;
  const msg = msgs[idx];
  const current = msg.thread_summary;
  const updated = {
    ...msg,
    thread_summary: {
      reply_count: (current?.reply_count || 0) + 1,
      last_reply_at: new Date().toISOString(),
      last_reply_author: authorUsername,
    },
  };
  setMessages(channelId, [...msgs.slice(0, idx), updated, ...msgs.slice(idx + 1)]);
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd ~/projects/GamersGuild/client && npx tsc --noEmit 2>&1 | grep -v "error TS" | tail -5
```

Check for new errors only (there are pre-existing TS errors in the codebase).

- [ ] **Step 5: Commit**

```bash
cd ~/projects/GamersGuild
git add client/src/stores/messages.ts client/src/lib/api.ts client/src/lib/events.ts
git commit -m "feat: add thread types, API functions, and message_create routing"
```

---

### Task 7: Frontend — ThreadIndicator Component

**Files:**
- Create: `~/projects/GamersGuild/client/src/components/TextChannel/ThreadIndicator.tsx`

- [ ] **Step 1: Create ThreadIndicator.tsx**

Create `~/projects/GamersGuild/client/src/components/TextChannel/ThreadIndicator.tsx`:

```tsx
import { openThread } from "../../stores/messages";

interface ThreadSummary {
  reply_count: number;
  last_reply_at: string;
  last_reply_author: string;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function ThreadIndicator(props: { threadId: string; summary: ThreadSummary }) {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        openThread(props.threadId);
      }}
      style={{
        display: "flex",
        "align-items": "center",
        "font-size": "11px",
        color: "var(--cyan)",
        cursor: "pointer",
        "padding-left": "60px",
        "margin-top": "-2px",
        "margin-bottom": "2px",
      }}
    >
      <span style={{ color: "var(--border-gold)", "margin-right": "6px" }}>{"──"}</span>
      <span style={{ "margin-right": "4px" }}>
        {props.summary.reply_count} {props.summary.reply_count === 1 ? "reply" : "replies"}
      </span>
      <span style={{ color: "var(--text-muted)" }}>
        · last {formatRelativeTime(props.summary.last_reply_at)}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/GamersGuild
git add client/src/components/TextChannel/ThreadIndicator.tsx
git commit -m "feat: add ThreadIndicator component"
```

---

### Task 8: Frontend — ThreadPanel Component

**Files:**
- Create: `~/projects/GamersGuild/client/src/components/TextChannel/ThreadPanel.tsx`

- [ ] **Step 1: Create ThreadPanel.tsx**

Create `~/projects/GamersGuild/client/src/components/TextChannel/ThreadPanel.tsx`:

```tsx
import { createEffect, createSignal, For, Show, onCleanup } from "solid-js";
import {
  threadPanelOpen, setThreadPanelOpen,
  activeThreadId,
  threadMessages, setThreadMessages,
  threadPanelTab, setThreadPanelTab,
  messagesByChannel,
} from "../../stores/messages";
import { getThreadMessages, getStarredMessages, starMessage, unstarMessage } from "../../lib/api";
import { currentUser } from "../../stores/auth";
import MessageItem from "./Message";

// Find the thread root message from the main feed
function findThreadRoot(threadId: string): any | null {
  for (const channelId in messagesByChannel) {
    const msgs = messagesByChannel[channelId];
    if (msgs) {
      const root = msgs.find((m: any) => m.id === threadId);
      if (root) return root;
    }
  }
  return null;
}

export default function ThreadPanel(props: { channelId: string; send: (op: string, data: any) => void }) {
  const [starredMessages, setStarredMessages] = createSignal<any[]>([]);
  const [threadInput, setThreadInput] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;

  // Fetch thread messages when thread changes
  createEffect(() => {
    const threadId = activeThreadId();
    if (threadId && threadPanelTab() === "thread") {
      setLoading(true);
      getThreadMessages(props.channelId, threadId)
        .then((msgs) => {
          setThreadMessages(msgs);
          setLoading(false);
          // Scroll to bottom
          setTimeout(() => messagesEndRef?.scrollIntoView({ behavior: "smooth" }), 100);
        })
        .catch(() => setLoading(false));
    }
  });

  // Fetch starred messages when starred tab opens
  createEffect(() => {
    if (threadPanelTab() === "starred" && threadPanelOpen()) {
      getStarredMessages()
        .then((msgs) => setStarredMessages(msgs))
        .catch(() => {});
    }
  });

  // Scroll to bottom when new thread messages arrive
  createEffect(() => {
    const msgs = threadMessages();
    if (msgs.length > 0 && threadPanelTab() === "thread") {
      setTimeout(() => messagesEndRef?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  });

  // Close on Escape
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && threadPanelOpen()) {
      setThreadPanelOpen(false);
    }
  };
  document.addEventListener("keydown", handleKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  const handleThreadSend = () => {
    const content = threadInput().trim();
    if (!content) return;
    const threadId = activeThreadId();
    if (!threadId) return;

    props.send("send_message", {
      channel_id: props.channelId,
      content,
      reply_to_id: null,
      thread_id: threadId,
      attachment_ids: [],
    });

    setThreadInput("");
  };

  const handleStar = async (messageId: string) => {
    await starMessage(messageId);
    // Refresh starred list if on starred tab
    if (threadPanelTab() === "starred") {
      const msgs = await getStarredMessages();
      setStarredMessages(msgs);
    }
  };

  const handleUnstar = async (messageId: string) => {
    await unstarMessage(messageId);
    setStarredMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  return (
    <Show when={threadPanelOpen()}>
      <div style={{
        width: "400px",
        "min-width": "400px",
        height: "100%",
        "border-left": "1px solid var(--border-gold)",
        "background-color": "var(--bg-secondary)",
        display: "flex",
        "flex-direction": "column",
      }}>
        {/* Header */}
        <div style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--border-gold)",
        }}>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => setThreadPanelTab("thread")}
              style={{
                "font-family": "var(--font-display)",
                "font-size": "11px",
                "letter-spacing": "1px",
                "text-transform": "uppercase",
                color: threadPanelTab() === "thread" ? "var(--accent)" : "var(--text-muted)",
                "border-bottom": threadPanelTab() === "thread" ? "2px solid var(--accent)" : "2px solid transparent",
                background: "none",
                border: "none",
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              Thread
            </button>
            <button
              onClick={() => setThreadPanelTab("starred")}
              style={{
                "font-family": "var(--font-display)",
                "font-size": "11px",
                "letter-spacing": "1px",
                "text-transform": "uppercase",
                color: threadPanelTab() === "starred" ? "var(--accent)" : "var(--text-muted)",
                "border-bottom": threadPanelTab() === "starred" ? "2px solid var(--accent)" : "2px solid transparent",
                background: "none",
                border: "none",
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              Starred
            </button>
          </div>
          <button
            onClick={() => setThreadPanelOpen(false)}
            style={{
              color: "var(--text-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              "font-size": "14px",
            }}
          >
            [x]
          </button>
        </div>

        {/* Thread tab content */}
        <Show when={threadPanelTab() === "thread"}>
          <div style={{ flex: "1", overflow: "auto", padding: "8px 12px" }}>
            {/* Thread root (pinned at top) */}
            <Show when={findThreadRoot(activeThreadId()!)}>
              {(root) => (
                <div style={{
                  "border-bottom": "1px solid var(--border-gold)",
                  "padding-bottom": "8px",
                  "margin-bottom": "8px",
                }}>
                  <MessageItem message={root()} highlighted={false} />
                  <button
                    onClick={() => handleStar(root().id)}
                    style={{
                      "font-size": "10px",
                      color: "var(--accent)",
                      background: "none",
                      border: "1px solid var(--accent)",
                      padding: "2px 6px",
                      cursor: "pointer",
                      "margin-top": "4px",
                      "margin-left": "60px",
                    }}
                  >
                    [star]
                  </button>
                </div>
              )}
            </Show>

            {/* Thread replies */}
            <Show when={loading()}>
              <div style={{ color: "var(--text-muted)", "font-size": "11px", padding: "12px 0" }}>
                Loading thread...
              </div>
            </Show>
            <For each={threadMessages().filter((m) => m.id !== activeThreadId())}>
              {(msg) => <MessageItem message={msg} highlighted={false} />}
            </For>
            <div ref={messagesEndRef} />
          </div>

          {/* Thread input */}
          <div style={{
            padding: "8px 12px",
            "border-top": "1px solid var(--border-gold)",
          }}>
            <input
              type="text"
              placeholder="Reply in thread..."
              value={threadInput()}
              onInput={(e) => setThreadInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleThreadSend();
                }
              }}
              style={{
                width: "100%",
                padding: "6px 10px",
                "background-color": "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-gold)",
                "font-size": "12px",
                "font-family": "var(--font-mono)",
              }}
            />
          </div>
        </Show>

        {/* Starred tab content */}
        <Show when={threadPanelTab() === "starred"}>
          <div style={{ flex: "1", overflow: "auto", padding: "8px 12px" }}>
            <Show when={starredMessages().length === 0}>
              <div style={{ color: "var(--text-muted)", "font-size": "11px", "font-style": "italic", padding: "12px 0" }}>
                No starred messages.
              </div>
            </Show>
            <For each={starredMessages()}>
              {(msg) => (
                <div style={{
                  "border-bottom": "1px solid rgba(201,168,76,0.1)",
                  padding: "8px 0",
                  cursor: "pointer",
                }}>
                  <div
                    onClick={() => {
                      if (msg.thread_id && msg.thread_id === msg.id) {
                        // Thread root — open the thread
                        setThreadPanelTab("thread");
                        import("../../stores/messages").then((mod) => mod.openThread(msg.id));
                      } else {
                        // Standalone message — scroll to it in main feed
                        setThreadPanelOpen(false);
                        import("../../stores/messages").then((mod) => mod.setScrollToMessageId(msg.id));
                      }
                    }}
                  >
                    <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                      <span style={{ "font-size": "12px", color: "var(--text-primary)" }}>
                        {msg.author_username || "unknown"}
                      </span>
                      <span style={{ "font-size": "10px", color: "var(--text-muted)" }}>
                        {new Date(msg.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div style={{ "font-size": "11px", color: "var(--text-secondary)", "margin-top": "2px" }}>
                      {msg.content ? msg.content.slice(0, 100) + (msg.content.length > 100 ? "..." : "") : "[attachment]"}
                    </div>
                    <Show when={msg.thread_id && msg.thread_id === msg.id}>
                      <div style={{ "font-size": "10px", color: "var(--cyan)", "margin-top": "2px" }}>
                        Thread
                      </div>
                    </Show>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleUnstar(msg.id); }}
                    style={{
                      "font-size": "10px",
                      color: "var(--danger)",
                      background: "none",
                      border: "1px solid var(--danger)",
                      padding: "1px 4px",
                      cursor: "pointer",
                      "margin-top": "4px",
                    }}
                  >
                    [unstar]
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/projects/GamersGuild
git add client/src/components/TextChannel/ThreadPanel.tsx
git commit -m "feat: add ThreadPanel slide-out component with Thread/Starred tabs"
```

---

### Task 9: Frontend — Wire Up Message Components

**Files:**
- Modify: `~/projects/GamersGuild/client/src/components/TextChannel/Message.tsx`
- Modify: `~/projects/GamersGuild/client/src/components/TextChannel/MessageList.tsx`
- Modify: `~/projects/GamersGuild/client/src/components/TextChannel/MessageInput.tsx`

- [ ] **Step 1: Add thread indicator to Message.tsx**

In `~/projects/GamersGuild/client/src/components/TextChannel/Message.tsx`, import `ThreadIndicator`:

```typescript
import ThreadIndicator from "./ThreadIndicator";
```

After the message content rendering (after the reply section, reactions section, unfurls, etc. — find the closing `</div>` of the main message content area), add:

```tsx
<Show when={props.message.thread_summary && props.message.thread_id === props.message.id}>
  <ThreadIndicator
    threadId={props.message.id}
    summary={props.message.thread_summary!}
  />
</Show>
```

- [ ] **Step 2: Add star button to Message hover actions**

In the desktop hover actions section (around lines 456-523), find the action buttons and add a star button:

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    import("../../lib/api").then((api) => api.starMessage(props.message.id));
  }}
  style={{
    color: "var(--accent)",
    "background-color": "var(--accent-glow)",
    border: "1px solid var(--accent)",
    padding: "0px 4px",
    "font-size": "11px",
    cursor: "pointer",
  }}
>
  [*]
</button>
```

- [ ] **Step 3: Add thread_id support to MessageInput.tsx**

In `~/projects/GamersGuild/client/src/components/TextChannel/MessageInput.tsx`, find the `handleSend` function (around line 137). The `send_message` payload needs to include `thread_id`. But for the main feed input, `thread_id` is always null — the thread panel has its own input. No changes needed to MessageInput.tsx for the main feed.

- [ ] **Step 4: Wire ThreadPanel into the channel layout**

Find the component that renders the `MessageList` and `MessageInput` together. This is likely in a parent component. Search for where `<MessageList` is rendered.

In the parent component (likely `TextChannel.tsx` or similar), add the ThreadPanel alongside the message area:

```tsx
import ThreadPanel from "./ThreadPanel";
import { threadPanelOpen } from "../../stores/messages";
```

Wrap the existing layout to include the panel:

```tsx
<div style={{ display: "flex", flex: "1", overflow: "hidden" }}>
  <div style={{ flex: "1", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
    {/* Existing MessageList + MessageInput */}
  </div>
  <ThreadPanel channelId={channelId} send={send} />
</div>
```

- [ ] **Step 5: Add star icon to channel header for opening starred tab**

Find the channel header component and add a star button that opens the panel's starred tab:

```tsx
import { setThreadPanelOpen, setThreadPanelTab } from "../../stores/messages";

<button
  onClick={() => { setThreadPanelTab("starred"); setThreadPanelOpen(true); }}
  style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer", "font-size": "12px" }}
>
  [*]
</button>
```

- [ ] **Step 6: Build frontend**

```bash
cd ~/projects/GamersGuild/client && npm run build
```

Expected: Build succeeds (warnings about chunk size are OK).

- [ ] **Step 7: Commit**

```bash
cd ~/projects/GamersGuild
git add client/src/
git commit -m "feat: wire thread indicator, star buttons, and thread panel into message components"
```

---

### Task 10: Nanobot — Thread-Scoped Sessions

**Files:**
- Modify: `~/projects/kindlyqr_nano/lefauxpain.py`

- [ ] **Step 1: Pass thread_id as session_key**

In `~/projects/kindlyqr_nano/lefauxpain.py`, find the `_handle_message_create` method. Update the `_handle_message` call to include `session_key`:

Find:
```python
        await self._handle_message(
            sender_id=author_id,
            chat_id=channel_id,
            content=content,
            metadata={
                "message_id": message_id,
                "channel_name": self._channels.get(channel_id, ""),
                "author_username": author.get("username", ""),
            },
        )
```

Replace with:
```python
        # Use thread_id as session key for isolated conversation context per thread
        thread_id = data.get("thread_id")
        session_key = thread_id if thread_id else None

        await self._handle_message(
            sender_id=author_id,
            chat_id=channel_id,
            content=content,
            session_key=session_key,
            metadata={
                "message_id": message_id,
                "thread_id": thread_id,
                "channel_name": self._channels.get(channel_id, ""),
                "author_username": author.get("username", ""),
            },
        )
```

- [ ] **Step 2: Include thread_id in outbound messages**

In the `send` method, find the `send_message` payload construction:

```python
            payload = json.dumps({
                "op": "send_message",
                "d": {
                    "channel_id": channel_id,
                    "content": chunk,
                }
            })
```

Update to include thread_id from metadata:

```python
            send_data = {
                "channel_id": channel_id,
                "content": chunk,
            }
            # Include thread_id if this is a thread reply
            thread_id = (msg.metadata or {}).get("thread_id")
            if thread_id:
                send_data["thread_id"] = thread_id

            payload = json.dumps({
                "op": "send_message",
                "d": send_data,
            })
```

- [ ] **Step 3: Update _handle_message_create to accept mentions from threads**

Currently the bot only responds to `<@bot_user_id>` mentions. In a thread, users should be able to just type without mentioning. Update the mention check:

Find the mention check block and update:
```python
        # In threads, respond to all messages (no mention required)
        # In main channel, require @mention
        thread_id = data.get("thread_id")
        if thread_id and thread_id != data.get("id"):
            # This is a thread reply — respond without needing mention
            pass
        else:
            # Main channel — require mention
            bot_mentioned = False
            if self._bot_user_id and f"<@{self._bot_user_id}>" in content:
                bot_mentioned = True
                content = content.replace(f"<@{self._bot_user_id}>", "").strip()

            if not bot_mentioned:
                return
```

- [ ] **Step 4: Rebuild Docker image**

```bash
cd ~/projects/kindlyqr_nano
cp lefauxpain.py lefauxpain.py  # already in place
docker compose down && docker compose up -d --build
```

- [ ] **Step 5: Commit**

```bash
cd ~/projects/kindlyqr_nano
# lefauxpain.py is the source file, also copy to venv for local dev
git add lefauxpain.py
git commit -m "feat: add thread-scoped sessions and thread_id in outbound messages"
```

---

### Task 11: Validation and Deploy

- [ ] **Step 1: Run existing validation suite**

```bash
cd ~/projects/GamersGuild && make validate
```

Expected: All existing scenarios pass. Thread changes should not affect existing message flow (thread_id defaults to NULL).

- [ ] **Step 2: Build frontend**

```bash
cd ~/projects/GamersGuild/client && npm run build
```

- [ ] **Step 3: Build backend**

```bash
cd ~/projects/GamersGuild
rm -rf server/static/assets/* server/static/index.html
cp -r client/dist/* server/static/
cd server && go build -o voicechat .
```

- [ ] **Step 4: Deploy to production**

```bash
scp server/voicechat kalman@172.233.131.169:/tmp/voicechat-new
scp -r client/dist/* kalman@172.233.131.169:/tmp/static-new/
ssh kalman@172.233.131.169 'sudo systemctl stop voicechat && sudo cp /tmp/voicechat-new /opt/voicechat/bin/voicechat && sudo chmod +x /opt/voicechat/bin/voicechat && sudo rm -rf /opt/voicechat/static/assets/* && sudo cp -r /tmp/static-new/* /opt/voicechat/static/ && sudo systemctl start voicechat'
```

- [ ] **Step 5: Verify deployment**

```bash
ssh kalman@172.233.131.169 'sudo systemctl is-active voicechat && curl -s http://localhost:8080/api/v1/health'
```

- [ ] **Step 6: Restart nanobot**

```bash
cd ~/projects/kindlyqr_nano && docker compose restart
```

- [ ] **Step 7: Test threads end-to-end**

In Le Faux Pain:
1. Reply to a message — verify it creates a thread (reply disappears from main feed, thread indicator appears)
2. Click the thread indicator — verify panel opens with the conversation
3. Reply in the thread panel — verify it stays in the thread
4. Star a message — verify it appears in the Starred tab
5. Mention @KindlyQR_bot in a thread — verify bot responds within the thread
