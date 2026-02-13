package db

import (
	"database/sql"
	"fmt"
)

type User struct {
	ID           string  `json:"id"`
	Username     string  `json:"username"`
	PasswordHash *string `json:"-"`
	IsAdmin      bool    `json:"is_admin"`
	AvatarPath   *string `json:"-"`
	AvatarURL    *string `json:"avatar_url"`
	CreatedAt    string  `json:"created_at"`
}

type Channel struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"`
	Position  int    `json:"position"`
	CreatedAt string `json:"created_at"`
}

func (d *DB) CreateUser(id, username string, passwordHash *string, isAdmin bool) error {
	_, err := d.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin) VALUES (?, ?, ?, ?)`,
		id, username, passwordHash, isAdmin,
	)
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (d *DB) GetUserByUsername(username string) (*User, error) {
	u := &User{}
	err := d.QueryRow(
		`SELECT id, username, password_hash, is_admin, avatar_path, created_at FROM users WHERE username = ?`,
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by username: %w", err)
	}
	return u, nil
}

func (d *DB) GetUserByID(id string) (*User, error) {
	u := &User{}
	err := d.QueryRow(
		`SELECT id, username, password_hash, is_admin, avatar_path, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return u, nil
}

func (d *DB) UserCount() (int, error) {
	var count int
	err := d.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}
	return count, nil
}

func (d *DB) CreateToken(token, userID string) error {
	_, err := d.Exec(
		`INSERT INTO tokens (token, user_id) VALUES (?, ?)`,
		token, userID,
	)
	if err != nil {
		return fmt.Errorf("create token: %w", err)
	}
	return nil
}

func (d *DB) GetUserByToken(token string) (*User, error) {
	u := &User{}
	err := d.QueryRow(
		`SELECT u.id, u.username, u.password_hash, u.is_admin, u.avatar_path, u.created_at
		 FROM users u
		 JOIN tokens t ON t.user_id = u.id
		 WHERE t.token = ? AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))`,
		token,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by token: %w", err)
	}
	return u, nil
}

func (d *DB) GetAllChannels() ([]Channel, error) {
	rows, err := d.Query(`SELECT id, name, type, position, created_at FROM channels ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("get channels: %w", err)
	}
	defer rows.Close()

	var channels []Channel
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan channel: %w", err)
		}
		channels = append(channels, c)
	}
	if channels == nil {
		channels = []Channel{}
	}
	return channels, rows.Err()
}
