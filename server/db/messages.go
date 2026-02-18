package db

import (
	"database/sql"
	"fmt"
)

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
		`SELECT id, channel_id, author_id, content, reply_to_id, created_at, edited_at, deleted_at
		 FROM messages WHERE id = ?`, id,
	).Scan(&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.ReplyToID, &m.CreatedAt, &m.EditedAt, &m.DeletedAt)
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
			`SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at,
			        COALESCE(u.username, 'Deleted User'), u.avatar_path
			 FROM messages m
			 LEFT JOIN users u ON u.id = m.author_id
			 WHERE m.channel_id = ? AND m.created_at < (SELECT created_at FROM messages WHERE id = ?)
			 ORDER BY m.created_at DESC
			 LIMIT ?`,
			channelID, *before, limit,
		)
	} else {
		rows, err = d.Query(
			`SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at,
			        COALESCE(u.username, 'Deleted User'), u.avatar_path
			 FROM messages m
			 LEFT JOIN users u ON u.id = m.author_id
			 WHERE m.channel_id = ?
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
			&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.ReplyToID,
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
		`SELECT m.id, m.channel_id, m.author_id, m.content, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at,
		        COALESCE(u.username, 'Deleted User'), u.avatar_path
		 FROM messages m
		 LEFT JOIN users u ON u.id = m.author_id
		 WHERE m.channel_id = ? AND (
		   m.created_at < (SELECT created_at FROM messages WHERE id = ?)
		   OR m.id = ?
		   OR m.created_at > (SELECT created_at FROM messages WHERE id = ?)
		 )
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
			&m.ID, &m.ChannelID, &m.AuthorID, &m.Content, &m.ReplyToID,
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
	return err
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
