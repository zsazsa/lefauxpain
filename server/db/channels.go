package db

import (
	"fmt"

	"github.com/google/uuid"
)

func (d *DB) CreateChannel(id, name, chType string) (*Channel, error) {
	var maxPos *int
	err := d.QueryRow(`SELECT MAX(position) FROM channels`).Scan(&maxPos)
	if err != nil {
		return nil, fmt.Errorf("get max position: %w", err)
	}
	pos := 0
	if maxPos != nil {
		pos = *maxPos + 1
	}

	_, err = d.Exec(
		`INSERT INTO channels (id, name, type, position) VALUES (?, ?, ?, ?)`,
		id, name, chType, pos,
	)
	if err != nil {
		return nil, fmt.Errorf("create channel: %w", err)
	}

	return &Channel{ID: id, Name: name, Type: chType, Position: pos}, nil
}

func (d *DB) DeleteChannel(id string) error {
	res, err := d.Exec(`DELETE FROM channels WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete channel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("channel not found")
	}
	return nil
}

func (d *DB) ReorderChannels(ids []string) error {
	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("begin reorder: %w", err)
	}
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE channels SET position = ? WHERE id = ?`, i, id); err != nil {
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
		`SELECT id, name, type, position, created_at FROM channels WHERE id = ?`, id,
	).Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}
	return c, nil
}
