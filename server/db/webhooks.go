package db

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
)

const BotUserID = "00000000-0000-0000-0000-000000000000"

type WebhookKey struct {
	ID        string `json:"id"`
	KeyPrefix string `json:"key_prefix"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

type WebhookKeyCreated struct {
	ID        string `json:"id"`
	Key       string `json:"key"`
	KeyPrefix string `json:"key_prefix"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

func hashKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}

// ValidateWebhookKey checks if the given key exists and returns the associated record.
func (d *DB) ValidateWebhookKey(key string) (*WebhookKey, error) {
	h := hashKey(key)
	wk := &WebhookKey{}
	err := d.QueryRow(
		`SELECT id, key_prefix, name, created_at FROM webhook_keys WHERE key_hash = ?`, h,
	).Scan(&wk.ID, &wk.KeyPrefix, &wk.Name, &wk.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("validate webhook key: %w", err)
	}
	return wk, nil
}

// CreateWebhookKey generates a new random API key, stores only the hash and prefix, and returns the full key once.
func (d *DB) CreateWebhookKey(name string) (*WebhookKeyCreated, error) {
	id := uuid.New().String()
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, fmt.Errorf("generate webhook key: %w", err)
	}
	key := "whk_" + hex.EncodeToString(keyBytes)
	h := hashKey(key)
	prefix := key[:8] + "..." + key[len(key)-4:]

	_, err := d.Exec(
		`INSERT INTO webhook_keys (id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?)`,
		id, h, prefix, name,
	)
	if err != nil {
		return nil, fmt.Errorf("create webhook key: %w", err)
	}
	return &WebhookKeyCreated{ID: id, Key: key, KeyPrefix: prefix, Name: name}, nil
}

// ListWebhookKeys returns all webhook keys with their display prefixes.
func (d *DB) ListWebhookKeys() ([]WebhookKey, error) {
	rows, err := d.Query(`SELECT id, key_prefix, name, created_at FROM webhook_keys ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list webhook keys: %w", err)
	}
	defer rows.Close()

	var keys []WebhookKey
	for rows.Next() {
		var wk WebhookKey
		if err := rows.Scan(&wk.ID, &wk.KeyPrefix, &wk.Name, &wk.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan webhook key: %w", err)
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
		BotUserID, "KindlyQR_bot",
	)
	if err != nil {
		return nil, fmt.Errorf("create bot user: %w", err)
	}
	return d.GetUserByID(BotUserID)
}
