package db

import (
	"fmt"

	"github.com/google/uuid"
)

func (d *DB) CreateChannel(id, name, chType, createdBy string) (*Channel, error) {
	var maxPos *int
	err := d.QueryRow(`SELECT MAX(position) FROM channels WHERE deleted_at IS NULL`).Scan(&maxPos)
	if err != nil {
		return nil, fmt.Errorf("get max position: %w", err)
	}
	pos := 0
	if maxPos != nil {
		pos = *maxPos + 1
	}

	tx, err := d.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin create channel: %w", err)
	}

	_, err = tx.Exec(
		`INSERT INTO channels (id, name, type, position, created_by) VALUES (?, ?, ?, ?, ?)`,
		id, name, chType, pos, createdBy,
	)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("create channel: %w", err)
	}

	// Auto-add creator as channel manager
	_, err = tx.Exec(
		`INSERT INTO channel_managers (channel_id, user_id) VALUES (?, ?)`,
		id, createdBy,
	)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("add creator as manager: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create channel: %w", err)
	}

	cb := createdBy
	return &Channel{ID: id, Name: name, Type: chType, Position: pos, CreatedBy: &cb}, nil
}

func (d *DB) DeleteChannel(id string) error {
	res, err := d.Exec(`UPDATE channels SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("soft delete channel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("channel not found")
	}
	return nil
}

func (d *DB) RenameChannel(id, name string) error {
	res, err := d.Exec(`UPDATE channels SET name = ? WHERE id = ? AND deleted_at IS NULL`, name, id)
	if err != nil {
		return fmt.Errorf("rename channel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("channel not found")
	}
	return nil
}

func (d *DB) RestoreChannel(id string) error {
	res, err := d.Exec(`UPDATE channels SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return fmt.Errorf("restore channel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("channel not found or not deleted")
	}
	return nil
}

func (d *DB) GetDeletedChannels() ([]Channel, error) {
	rows, err := d.Query(`SELECT id, name, type, position, created_by, deleted_at, created_at FROM channels WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("get deleted channels: %w", err)
	}
	defer rows.Close()

	var channels []Channel
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.CreatedBy, &c.DeletedAt, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan deleted channel: %w", err)
		}
		channels = append(channels, c)
	}
	if channels == nil {
		channels = []Channel{}
	}
	return channels, rows.Err()
}

func (d *DB) ReorderChannels(ids []string) error {
	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("begin reorder: %w", err)
	}
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE channels SET position = ? WHERE id = ? AND deleted_at IS NULL`, i, id); err != nil {
			tx.Rollback()
			return fmt.Errorf("reorder channel %s: %w", id, err)
		}
	}
	return tx.Commit()
}

func (d *DB) SeedDefaultChannels() error {
	defaults := []struct {
		name   string
		chType string
	}{
		{"lobby", "text"},
		{"General", "voice"},
	}
	for _, ch := range defaults {
		var exists int
		d.QueryRow(`SELECT COUNT(*) FROM channels WHERE name = ? AND type = ?`, ch.name, ch.chType).Scan(&exists)
		if exists > 0 {
			continue
		}
		// Use max position + 1
		var maxPos *int
		d.QueryRow(`SELECT MAX(position) FROM channels`).Scan(&maxPos)
		pos := 0
		if maxPos != nil {
			pos = *maxPos + 1
		}
		_, err := d.Exec(
			`INSERT INTO channels (id, name, type, position) VALUES (?, ?, ?, ?)`,
			uuid.New().String(), ch.name, ch.chType, pos,
		)
		if err != nil {
			return fmt.Errorf("seed channel %s: %w", ch.name, err)
		}
	}
	return nil
}

func (d *DB) GetChannelByID(id string) (*Channel, error) {
	c := &Channel{}
	err := d.QueryRow(
		`SELECT id, name, type, position, created_by, created_at FROM channels WHERE id = ? AND deleted_at IS NULL`, id,
	).Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.CreatedBy, &c.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}
	return c, nil
}

// Channel manager CRUD

func (d *DB) AddChannelManager(channelID, userID string) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO channel_managers (channel_id, user_id) VALUES (?, ?)`,
		channelID, userID,
	)
	if err != nil {
		return fmt.Errorf("add channel manager: %w", err)
	}
	return nil
}

func (d *DB) RemoveChannelManager(channelID, userID string) error {
	_, err := d.Exec(
		`DELETE FROM channel_managers WHERE channel_id = ? AND user_id = ?`,
		channelID, userID,
	)
	if err != nil {
		return fmt.Errorf("remove channel manager: %w", err)
	}
	return nil
}

func (d *DB) GetChannelManagers(channelID string) ([]string, error) {
	rows, err := d.Query(`SELECT user_id FROM channel_managers WHERE channel_id = ?`, channelID)
	if err != nil {
		return nil, fmt.Errorf("get channel managers: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan channel manager: %w", err)
		}
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, rows.Err()
}

// GetAllChannelManagers returns a map of channelID -> []userID for all non-deleted channels.
func (d *DB) GetAllChannelManagers() (map[string][]string, error) {
	rows, err := d.Query(`SELECT cm.channel_id, cm.user_id FROM channel_managers cm JOIN channels c ON c.id = cm.channel_id WHERE c.deleted_at IS NULL`)
	if err != nil {
		return nil, fmt.Errorf("get all channel managers: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]string)
	for rows.Next() {
		var channelID, userID string
		if err := rows.Scan(&channelID, &userID); err != nil {
			return nil, fmt.Errorf("scan channel manager: %w", err)
		}
		result[channelID] = append(result[channelID], userID)
	}
	return result, rows.Err()
}

func (d *DB) IsChannelManager(channelID, userID string) (bool, error) {
	var count int
	err := d.QueryRow(
		`SELECT COUNT(*) FROM channel_managers WHERE channel_id = ? AND user_id = ?`,
		channelID, userID,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check channel manager: %w", err)
	}
	return count > 0, nil
}
