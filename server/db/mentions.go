package db

import "fmt"

func (d *DB) CreateMentions(messageID string, userIDs []string) error {
	for _, uid := range userIDs {
		_, err := d.Exec(
			`INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)`,
			messageID, uid,
		)
		if err != nil {
			return fmt.Errorf("create mention: %w", err)
		}
	}
	return nil
}

func (d *DB) GetMentionsByMessage(messageID string) ([]string, error) {
	rows, err := d.Query(`SELECT user_id FROM mentions WHERE message_id = ?`, messageID)
	if err != nil {
		return nil, fmt.Errorf("get mentions: %w", err)
	}
	defer rows.Close()

	var userIDs []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return nil, fmt.Errorf("scan mention: %w", err)
		}
		userIDs = append(userIDs, uid)
	}
	if userIDs == nil {
		userIDs = []string{}
	}
	return userIDs, rows.Err()
}
