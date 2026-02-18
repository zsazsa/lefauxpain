package db

import (
	"encoding/json"
	"fmt"
)

type Notification struct {
	ID        string          `json:"id"`
	UserID    string          `json:"user_id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	Read      bool            `json:"read"`
	CreatedAt string          `json:"created_at"`
}

func (d *DB) CreateNotification(id, userID, notifType string, data any) error {
	dataJSON, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal notification data: %w", err)
	}
	_, err = d.Exec(
		`INSERT INTO notifications (id, user_id, type, data) VALUES (?, ?, ?, ?)`,
		id, userID, notifType, string(dataJSON),
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
		`SELECT id, user_id, type, data, read, created_at
		 FROM notifications
		 WHERE user_id = ? AND read = FALSE
		 ORDER BY created_at DESC
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
		var dataStr string
		if err := rows.Scan(&n.ID, &n.UserID, &n.Type, &dataStr, &n.Read, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan notification: %w", err)
		}
		n.Data = json.RawMessage(dataStr)
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
