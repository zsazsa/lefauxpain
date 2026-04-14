package db

import (
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

// GetStarredMessageIDs returns the set of message IDs starred by a user from the given list.
func (d *DB) GetStarredMessageIDs(userID string, messageIDs []string) (map[string]bool, error) {
	result := make(map[string]bool)
	if len(messageIDs) == 0 {
		return result, nil
	}
	placeholders := make([]string, len(messageIDs))
	args := make([]interface{}, 0, len(messageIDs)+1)
	args = append(args, userID)
	for i, id := range messageIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	query := fmt.Sprintf(
		`SELECT message_id FROM starred_messages WHERE user_id = ? AND message_id IN (%s)`,
		joinStrings(placeholders, ","),
	)
	rows, err := d.Query(query, args...)
	if err != nil {
		return result, fmt.Errorf("get starred message ids: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		result[id] = true
	}
	return result, nil
}

func joinStrings(s []string, sep string) string {
	if len(s) == 0 {
		return ""
	}
	r := s[0]
	for _, v := range s[1:] {
		r += sep + v
	}
	return r
}

// StarredMessage is a message with its star timestamp.
type StarredMessage struct {
	Message
	StarredAt      string `json:"starred_at"`
	AuthorUsername  string `json:"author_username"`
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
