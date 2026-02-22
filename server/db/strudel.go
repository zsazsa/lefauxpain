package db

import (
	"database/sql"
	"fmt"
)

type StrudelPattern struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Code       string `json:"code"`
	OwnerID    string `json:"owner_id"`
	Visibility string `json:"visibility"`
	CreatedAt  string `json:"created_at"`
	UpdatedAt  string `json:"updated_at"`
}

func (d *DB) CreateStrudelPattern(id, name, ownerID string) (*StrudelPattern, error) {
	_, err := d.Exec(
		`INSERT INTO strudel_patterns (id, name, owner_id) VALUES (?, ?, ?)`,
		id, name, ownerID,
	)
	if err != nil {
		return nil, fmt.Errorf("create strudel pattern: %w", err)
	}
	return d.GetStrudelPattern(id)
}

func (d *DB) GetStrudelPattern(id string) (*StrudelPattern, error) {
	var p StrudelPattern
	err := d.QueryRow(
		`SELECT id, name, code, owner_id, visibility, created_at, updated_at FROM strudel_patterns WHERE id = ?`,
		id,
	).Scan(&p.ID, &p.Name, &p.Code, &p.OwnerID, &p.Visibility, &p.CreatedAt, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get strudel pattern: %w", err)
	}
	return &p, nil
}

func (d *DB) UpdateStrudelPattern(id string, name, code, visibility *string) error {
	if name != nil {
		if _, err := d.Exec(
			`UPDATE strudel_patterns SET name = ?, updated_at = datetime('now') WHERE id = ?`,
			*name, id,
		); err != nil {
			return fmt.Errorf("update strudel pattern name: %w", err)
		}
	}
	if code != nil {
		if _, err := d.Exec(
			`UPDATE strudel_patterns SET code = ?, updated_at = datetime('now') WHERE id = ?`,
			*code, id,
		); err != nil {
			return fmt.Errorf("update strudel pattern code: %w", err)
		}
	}
	if visibility != nil {
		if _, err := d.Exec(
			`UPDATE strudel_patterns SET visibility = ?, updated_at = datetime('now') WHERE id = ?`,
			*visibility, id,
		); err != nil {
			return fmt.Errorf("update strudel pattern visibility: %w", err)
		}
	}
	return nil
}

func (d *DB) DeleteStrudelPattern(id string) error {
	_, err := d.Exec(`DELETE FROM strudel_patterns WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete strudel pattern: %w", err)
	}
	return nil
}

// ListStrudelPatterns returns all non-private patterns plus the given user's private patterns.
func (d *DB) ListStrudelPatterns(userID string) ([]StrudelPattern, error) {
	rows, err := d.Query(
		`SELECT id, name, code, owner_id, visibility, created_at, updated_at
		 FROM strudel_patterns
		 WHERE visibility != 'private' OR owner_id = ?
		 ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list strudel patterns: %w", err)
	}
	defer rows.Close()

	var patterns []StrudelPattern
	for rows.Next() {
		var p StrudelPattern
		if err := rows.Scan(&p.ID, &p.Name, &p.Code, &p.OwnerID, &p.Visibility, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan strudel pattern: %w", err)
		}
		patterns = append(patterns, p)
	}
	return patterns, nil
}
