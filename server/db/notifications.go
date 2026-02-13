package db

import "fmt"

type Notification struct {
	ID             string  `json:"id"`
	UserID         string  `json:"user_id"`
	MessageID      string  `json:"message_id"`
	ChannelID      string  `json:"channel_id"`
	ChannelName    string  `json:"channel_name"`
	AuthorID       string  `json:"author_id"`
	AuthorUsername string  `json:"author_username"`
	ContentPreview *string `json:"content_preview"`
	Read           bool    `json:"read"`
	CreatedAt      string  `json:"created_at"`
}

func (d *DB) CreateNotification(id, userID, messageID, channelID, authorID string) error {
	_, err := d.Exec(
		`INSERT INTO notifications (id, user_id, message_id, channel_id, author_id) VALUES (?, ?, ?, ?, ?)`,
		id, userID, messageID, channelID, authorID,
	)
	if err != nil {
		return fmt.Errorf("create notification: %w", err)
	}
	return nil
}

func (d *DB) GetUnreadNotifications(userID string, limit int) ([]Notification, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := d.Query(
		`SELECT n.id, n.user_id, n.message_id, n.channel_id, c.name, n.author_id, u.username, m.content, n.read, n.created_at
		 FROM notifications n
		 JOIN users u ON u.id = n.author_id
		 JOIN channels c ON c.id = n.channel_id
		 JOIN messages m ON m.id = n.message_id
		 WHERE n.user_id = ? AND n.read = FALSE
		 ORDER BY n.created_at DESC
		 LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("get unread notifications: %w", err)
	}
	defer rows.Close()

	var notifications []Notification
	for rows.Next() {
		var n Notification
		var content *string
		if err := rows.Scan(&n.ID, &n.UserID, &n.MessageID, &n.ChannelID, &n.ChannelName,
			&n.AuthorID, &n.AuthorUsername, &content, &n.Read, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		if content != nil {
			preview := *content
			if len(preview) > 80 {
				preview = preview[:80] + "..."
			}
			n.ContentPreview = &preview
		}
		notifications = append(notifications, n)
	}
	if notifications == nil {
		notifications = []Notification{}
	}
	return notifications, rows.Err()
}

func (d *DB) MarkNotificationRead(id, userID string) error {
	_, err := d.Exec(
		`UPDATE notifications SET read = TRUE WHERE id = ? AND user_id = ?`,
		id, userID,
	)
	return err
}

func (d *DB) MarkAllNotificationsRead(userID string) error {
	_, err := d.Exec(
		`UPDATE notifications SET read = TRUE WHERE user_id = ? AND read = FALSE`,
		userID,
	)
	return err
}
