package db

import (
	"database/sql"
	"fmt"
	"strings"
)

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

type MessageWithAuthor struct {
	Message
	AuthorUsername  string  `json:"author_username"`
	AuthorAvatarURL *string `json:"author_avatar_url"`
}

type ReplyContext struct {
	ID              string  `json:"id"`
	AuthorID        *string `json:"author_id"`
	AuthorUsername  string  `json:"author_username"`
	AuthorAvatarURL *string `json:"author_avatar_url"`
	Content         *string `json:"content"`
	DeletedAt       *string `json:"deleted_at"`
}

func (d *DB) CreateMessage(id, channelID, authorID string, content *string, replyToID *string) (*Message, error) {
	_, err := d.Exec(
		`INSERT INTO messages (id, channel_id, author_id, content, reply_to_id) VALUES (?, ?, ?, ?, ?)`,
		id, channelID, authorID, content, replyToID,
	)
	if err != nil {
		return nil, fmt.Errorf("create message: %w", err)
	}

	return d.GetMessageByID(id)
}

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

func (d *DB) GetMessages(channelID string, limit int, before *string) ([]MessageWithAuthor, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var rows *sql.Rows
	var err error

	if before != nil {
		rows, err = d.Query(
			`SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to_id, m.thread_id, m.created_at, m.edited_at, m.deleted_at,
			        COALESCE(u.username, 'Deleted User'), u.avatar_path
			 FROM messages m
			 LEFT JOIN users u ON u.id = m.author_id
			 WHERE m.channel_id = ? AND m.created_at < (SELECT created_at FROM messages WHERE id = ?)
			 AND (m.thread_id IS NULL OR m.thread_id = m.id)
			 ORDER BY m.created_at DESC
			 LIMIT ?`,
			channelID, *before, limit,
		)
	} else {
		rows, err = d.Query(
			`SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to_id, m.thread_id, m.created_at, m.edited_at, m.deleted_at,
			        COALESCE(u.username, 'Deleted User'), u.avatar_path
			 FROM messages m
			 LEFT JOIN users u ON u.id = m.author_id
			 WHERE m.channel_id = ?
			 AND (m.thread_id IS NULL OR m.thread_id = m.id)
			 ORDER BY m.created_at DESC
			 LIMIT ?`,
			channelID, limit,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("get messages: %w", err)
	}
	defer rows.Close()

	var messages []MessageWithAuthor
	for rows.Next() {
		var m MessageWithAuthor
		if err := rows.Scan(
			&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.ReplyToID, &m.ThreadID,
			&m.CreatedAt, &m.EditedAt, &m.DeletedAt, &m.AuthorUsername, &m.AuthorAvatarURL,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, m)
	}
	if messages == nil {
		messages = []MessageWithAuthor{}
	}
	return messages, rows.Err()
}

func (d *DB) GetMessagesAround(channelID string, messageID string, limit int) ([]MessageWithAuthor, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	half := limit / 2

	rows, err := d.Query(
		`SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to_id, m.thread_id, m.created_at, m.edited_at, m.deleted_at,
		        COALESCE(u.username, 'Deleted User'), u.avatar_path
		 FROM messages m
		 LEFT JOIN users u ON u.id = m.author_id
		 WHERE m.channel_id = ? AND (
		   m.created_at < (SELECT created_at FROM messages WHERE id = ?)
		   OR m.id = ?
		   OR m.created_at > (SELECT created_at FROM messages WHERE id = ?)
		 )
		 AND (m.thread_id IS NULL OR m.thread_id = m.id)
		 ORDER BY m.created_at ASC`,
		channelID, messageID, messageID, messageID,
	)
	if err != nil {
		return nil, fmt.Errorf("get messages around: %w", err)
	}
	defer rows.Close()

	var all []MessageWithAuthor
	targetIdx := -1
	for rows.Next() {
		var m MessageWithAuthor
		if err := rows.Scan(
			&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.ReplyToID, &m.ThreadID,
			&m.CreatedAt, &m.EditedAt, &m.DeletedAt, &m.AuthorUsername, &m.AuthorAvatarURL,
		); err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		if m.ID == messageID {
			targetIdx = len(all)
		}
		all = append(all, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if targetIdx == -1 {
		return []MessageWithAuthor{}, nil
	}

	// Window around the target
	start := targetIdx - half
	if start < 0 {
		start = 0
	}
	end := targetIdx + half + 1
	if end > len(all) {
		end = len(all)
	}

	// Return in DESC order (newest first) to match GetMessages convention
	result := all[start:end]
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}
	return result, nil
}

func (d *DB) EditMessage(id, content string) error {
	_, err := d.Exec(
		`UPDATE messages SET content = ?, edited_at = datetime('now') WHERE id = ?`,
		content, id,
	)
	return err
}

func (d *DB) DeleteMessage(id string) error {
	_, err := d.Exec(
		`UPDATE messages SET content = NULL, deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`,
		id,
	)
	if err != nil {
		return err
	}
	d.Exec(`DELETE FROM url_unfurls WHERE message_id = ?`, id)
	// Unlink attachments so the orphan cleanup goroutine deletes the files
	d.Exec(`UPDATE attachments SET message_id = NULL WHERE message_id = ?`, id)
	return nil
}

func (d *DB) GetReplyContext(messageID string) (*ReplyContext, error) {
	rc := &ReplyContext{}
	err := d.QueryRow(
		`SELECT m.id, m.author_id, COALESCE(u.username, 'Deleted User'), u.avatar_path, m.content, m.deleted_at
		 FROM messages m
		 LEFT JOIN users u ON u.id = m.author_id
		 WHERE m.id = ?`, messageID,
	).Scan(&rc.ID, &rc.AuthorID, &rc.AuthorUsername, &rc.AuthorAvatarURL, &rc.Content, &rc.DeletedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get reply context: %w", err)
	}
	// Truncate content to 100 chars
	if rc.Content != nil && len(*rc.Content) > 100 {
		truncated := (*rc.Content)[:100] + "..."
		rc.Content = &truncated
	}
	return rc, nil
}

func (d *DB) SetThreadID(messageID string, threadID string) error {
	_, err := d.Exec(`UPDATE messages SET thread_id = ? WHERE id = ?`, threadID, messageID)
	if err != nil {
		return fmt.Errorf("set thread id: %w", err)
	}
	return nil
}

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

type ThreadSummary struct {
	ThreadID        string `json:"thread_id"`
	ReplyCount      int    `json:"reply_count"`
	LastReplyAt     string `json:"last_reply_at"`
	LastReplyAuthor string `json:"last_reply_author"`
}

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
