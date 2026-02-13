package db

import "fmt"

type Reaction struct {
	MessageID string `json:"message_id"`
	UserID    string `json:"user_id"`
	Emoji     string `json:"emoji"`
}

type ReactionGroup struct {
	Emoji   string   `json:"emoji"`
	Count   int      `json:"count"`
	UserIDs []string `json:"user_ids"`
}

func (d *DB) AddReaction(messageID, userID, emoji string) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)`,
		messageID, userID, emoji,
	)
	if err != nil {
		return fmt.Errorf("add reaction: %w", err)
	}
	return nil
}

func (d *DB) RemoveReaction(messageID, userID, emoji string) error {
	_, err := d.Exec(
		`DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?`,
		messageID, userID, emoji,
	)
	if err != nil {
		return fmt.Errorf("remove reaction: %w", err)
	}
	return nil
}

func (d *DB) GetReactionsByMessage(messageID string) ([]ReactionGroup, error) {
	rows, err := d.Query(
		`SELECT emoji, user_id FROM reactions WHERE message_id = ? ORDER BY emoji, created_at`,
		messageID,
	)
	if err != nil {
		return nil, fmt.Errorf("get reactions: %w", err)
	}
	defer rows.Close()

	groups := map[string]*ReactionGroup{}
	var order []string
	for rows.Next() {
		var emoji, userID string
		if err := rows.Scan(&emoji, &userID); err != nil {
			return nil, fmt.Errorf("scan reaction: %w", err)
		}
		g, ok := groups[emoji]
		if !ok {
			g = &ReactionGroup{Emoji: emoji, UserIDs: []string{}}
			groups[emoji] = g
			order = append(order, emoji)
		}
		g.Count++
		g.UserIDs = append(g.UserIDs, userID)
	}

	result := make([]ReactionGroup, 0, len(order))
	for _, emoji := range order {
		result = append(result, *groups[emoji])
	}
	return result, rows.Err()
}
