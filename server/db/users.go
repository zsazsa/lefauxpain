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
	Approved     bool    `json:"approved"`
	KnockMessage *string `json:"knock_message,omitempty"`
	CreatedAt    string  `json:"created_at"`
}

type Channel struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Position  int     `json:"position"`
	CreatedBy *string `json:"created_by"`
	DeletedAt *string `json:"deleted_at"`
	CreatedAt string  `json:"created_at"`
}

func (d *DB) CreateUser(id, username string, passwordHash *string, isAdmin, approved bool, knockMessage *string) error {
	_, err := d.Exec(
		`INSERT INTO users (id, username, password_hash, is_admin, approved, knock_message) VALUES (?, ?, ?, ?, ?, ?)`,
		id, username, passwordHash, isAdmin, approved, knockMessage,
	)
	if err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (d *DB) GetUserByUsername(username string) (*User, error) {
	u := &User{}
	err := d.QueryRow(
		`SELECT id, username, password_hash, is_admin, avatar_path, approved, knock_message, created_at FROM users WHERE username = ?`,
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.Approved, &u.KnockMessage, &u.CreatedAt)
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
		`SELECT id, username, password_hash, is_admin, avatar_path, approved, knock_message, created_at FROM users WHERE id = ?`,
		id,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.Approved, &u.KnockMessage, &u.CreatedAt)
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
		`SELECT u.id, u.username, u.password_hash, u.is_admin, u.avatar_path, u.approved, u.knock_message, u.created_at
		 FROM users u
		 JOIN tokens t ON t.user_id = u.id
		 WHERE t.token = ? AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))`,
		token,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.Approved, &u.KnockMessage, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by token: %w", err)
	}
	return u, nil
}

func (d *DB) GetAllUsers() ([]User, error) {
	rows, err := d.Query(`SELECT id, username, password_hash, is_admin, avatar_path, approved, knock_message, created_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("get all users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.Approved, &u.KnockMessage, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	if users == nil {
		users = []User{}
	}
	return users, rows.Err()
}

func (d *DB) GetAdminUsers() ([]User, error) {
	rows, err := d.Query(`SELECT id, username, password_hash, is_admin, avatar_path, approved, knock_message, created_at FROM users WHERE is_admin = TRUE AND approved = TRUE`)
	if err != nil {
		return nil, fmt.Errorf("get admin users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.Approved, &u.KnockMessage, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan admin user: %w", err)
		}
		users = append(users, u)
	}
	if users == nil {
		users = []User{}
	}
	return users, rows.Err()
}

func (d *DB) ApproveUser(id string) error {
	_, err := d.Exec(`UPDATE users SET approved = TRUE WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("approve user: %w", err)
	}
	return nil
}

func (d *DB) GetPendingUsers() ([]User, error) {
	rows, err := d.Query(`SELECT id, username, password_hash, is_admin, avatar_path, approved, knock_message, created_at FROM users WHERE approved = FALSE ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("get pending users: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.IsAdmin, &u.AvatarPath, &u.Approved, &u.KnockMessage, &u.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan pending user: %w", err)
		}
		users = append(users, u)
	}
	if users == nil {
		users = []User{}
	}
	return users, rows.Err()
}

func (d *DB) DeleteUser(id string) error {
	_, err := d.Exec(`DELETE FROM tokens WHERE user_id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete user tokens: %w", err)
	}
	_, err = d.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	return nil
}

func (d *DB) SetPassword(id string, passwordHash *string) error {
	_, err := d.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, passwordHash, id)
	if err != nil {
		return fmt.Errorf("set password: %w", err)
	}
	return nil
}

func (d *DB) SetAdmin(id string, isAdmin bool) error {
	_, err := d.Exec(`UPDATE users SET is_admin = ? WHERE id = ?`, isAdmin, id)
	if err != nil {
		return fmt.Errorf("set admin: %w", err)
	}
	return nil
}

func (d *DB) GetAllChannels() ([]Channel, error) {
	rows, err := d.Query(`SELECT id, name, type, position, created_by, created_at FROM channels WHERE deleted_at IS NULL ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("get channels: %w", err)
	}
	defer rows.Close()

	var channels []Channel
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.CreatedBy, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan channel: %w", err)
		}
		channels = append(channels, c)
	}
	if channels == nil {
		channels = []Channel{}
	}
	return channels, rows.Err()
}
