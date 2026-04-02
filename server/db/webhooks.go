package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
)

const BotUserID = "00000000-0000-0000-0000-000000000000"

type WebhookKey struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

// ValidateWebhookKey checks if the given key exists and returns the associated record.
func (d *DB) ValidateWebhookKey(key string) (*WebhookKey, error) {
	wk := &WebhookKey{}
	err := d.QueryRow(
		`SELECT id, key, name, created_at FROM webhook_keys WHERE key = ?`, key,
	).Scan(&wk.ID, &wk.Key, &wk.Name, &wk.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("validate webhook key: %w", err)
	}
	return wk, nil
}

// CreateWebhookKey generates a new random API key and stores it.
func (d *DB) CreateWebhookKey(name string) (*WebhookKey, error) {
	id := uuid.New().String()
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, fmt.Errorf("generate webhook key: %w", err)
	}
	key := "whk_" + hex.EncodeToString(keyBytes)

	_, err := d.Exec(
		`INSERT INTO webhook_keys (id, key, name) VALUES (?, ?, ?)`,
		id, key, name,
	)
	if err != nil {
		return nil, fmt.Errorf("create webhook key: %w", err)
	}
	return &WebhookKey{ID: id, Key: key, Name: name}, nil
}

// ListWebhookKeys returns all webhook keys with keys truncated for display.
func (d *DB) ListWebhookKeys() ([]WebhookKey, error) {
	rows, err := d.Query(`SELECT id, key, name, created_at FROM webhook_keys ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list webhook keys: %w", err)
	}
	defer rows.Close()

	var keys []WebhookKey
	for rows.Next() {
		var wk WebhookKey
		if err := rows.Scan(&wk.ID, &wk.Key, &wk.Name, &wk.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan webhook key: %w", err)
		}
		// Truncate key for display: show prefix + last 4 chars
		if len(wk.Key) > 8 {
			wk.Key = wk.Key[:4] + "..." + wk.Key[len(wk.Key)-4:]
		}
		keys = append(keys, wk)
	}
	return keys, nil
}

// DeleteWebhookKey removes a webhook key by ID.
func (d *DB) DeleteWebhookKey(id string) error {
	result, err := d.Exec(`DELETE FROM webhook_keys WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete webhook key: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("webhook key not found")
	}
	return nil
}

// GetChannelByName finds a non-deleted channel by its name (case-insensitive).
func (d *DB) GetChannelByName(name string) (*Channel, error) {
	c := &Channel{}
	err := d.QueryRow(
		`SELECT id, name, type, position, created_by, created_at FROM channels WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL`, name,
	).Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.CreatedBy, &c.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get channel by name: %w", err)
	}
	return c, nil
}

// GetBotUser returns the bot user used for webhook messages.
// Creates the bot user on first access if it doesn't exist.
func (d *DB) GetBotUser() (*User, error) {
	user, err := d.GetUserByID(BotUserID)
	if err != nil {
		return nil, err
	}
	if user != nil {
		return user, nil
	}
	// Lazily create bot user — not in migration to avoid interfering with
	// the "first registered user is admin" logic (which counts all users).
	_, err = d.Exec(
		`INSERT OR IGNORE INTO users (id, username, password_hash, is_admin, approved, created_at) VALUES (?, ?, NULL, 0, 1, datetime('now'))`,
		BotUserID, "Lightover Agent",
	)
	if err != nil {
		return nil, fmt.Errorf("create bot user: %w", err)
	}
	return d.GetUserByID(BotUserID)
}
