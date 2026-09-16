package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"

	"github.com/google/uuid"
)

// APIKeyPrefix marks personal API keys so callers can tell them apart from
// session tokens and webhook keys.
const APIKeyPrefix = "lfp_"

// MaxAPIKeysPerUser caps how many active keys one account can hold.
const MaxAPIKeysPerUser = 20

type APIKey struct {
	ID         string  `json:"id"`
	KeyPrefix  string  `json:"key_prefix"`
	Name       string  `json:"name"`
	CreatedAt  string  `json:"created_at"`
	LastUsedAt *string `json:"last_used_at"`
}

type APIKeyCreated struct {
	APIKey
	Key string `json:"key"`
}

// CreateAPIKey mints a personal API key for userID. Only the hash and a
// display prefix are stored; the full key is returned exactly once.
func (d *DB) CreateAPIKey(userID, name string) (*APIKeyCreated, error) {
	var count int
	if err := d.QueryRow(`SELECT COUNT(*) FROM api_keys WHERE user_id = ?`, userID).Scan(&count); err != nil {
		return nil, fmt.Errorf("count api keys: %w", err)
	}
	if count >= MaxAPIKeysPerUser {
		return nil, fmt.Errorf("api key limit reached (%d)", MaxAPIKeysPerUser)
	}

	id := uuid.New().String()
	keyBytes := make([]byte, 32)
	if _, err := rand.Read(keyBytes); err != nil {
		return nil, fmt.Errorf("generate api key: %w", err)
	}
	key := APIKeyPrefix + hex.EncodeToString(keyBytes)
	h := hashKey(key)
	prefix := key[:8] + "..." + key[len(key)-4:]

	_, err := d.Exec(
		`INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name) VALUES (?, ?, ?, ?, ?)`,
		id, userID, h, prefix, name,
	)
	if err != nil {
		return nil, fmt.Errorf("create api key: %w", err)
	}
	var createdAt string
	_ = d.QueryRow(`SELECT created_at FROM api_keys WHERE id = ?`, id).Scan(&createdAt)
	return &APIKeyCreated{
		APIKey: APIKey{ID: id, KeyPrefix: prefix, Name: name, CreatedAt: createdAt},
		Key:    key,
	}, nil
}

// ListAPIKeys returns the caller's keys, newest first.
func (d *DB) ListAPIKeys(userID string) ([]APIKey, error) {
	rows, err := d.Query(
		`SELECT id, key_prefix, name, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list api keys: %w", err)
	}
	defer rows.Close()

	keys := []APIKey{}
	for rows.Next() {
		var k APIKey
		if err := rows.Scan(&k.ID, &k.KeyPrefix, &k.Name, &k.CreatedAt, &k.LastUsedAt); err != nil {
			return nil, fmt.Errorf("scan api key: %w", err)
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// DeleteAPIKey revokes one of the caller's own keys.
func (d *DB) DeleteAPIKey(userID, id string) error {
	result, err := d.Exec(`DELETE FROM api_keys WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete api key: %w", err)
	}
	if n, _ := result.RowsAffected(); n == 0 {
		return fmt.Errorf("api key not found")
	}
	return nil
}

// GetUserByAPIKey resolves a personal API key to its owner and records the use.
func (d *DB) GetUserByAPIKey(key string) (*User, error) {
	var id, userID string
	err := d.QueryRow(`SELECT id, user_id FROM api_keys WHERE key_hash = ?`, hashKey(key)).Scan(&id, &userID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by api key: %w", err)
	}
	_, _ = d.Exec(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`, id)
	return d.GetUserByID(userID)
}
