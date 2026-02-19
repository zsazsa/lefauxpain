package db

import (
	"database/sql"
	"fmt"
	"time"
)

type VerificationCode struct {
	ID        string
	UserID    string
	CodeHash  string
	Expired   bool
	Attempts  int
	CreatedAt string
}

func (d *DB) CreateVerificationCode(id, userID, codeHash string, expiresAt time.Time) error {
	// Delete existing codes for this user (one active code per user)
	if _, err := d.Exec(`DELETE FROM verification_codes WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete old verification codes: %w", err)
	}
	_, err := d.Exec(
		`INSERT INTO verification_codes (id, user_id, code_hash, expires_at) VALUES (?, ?, ?, ?)`,
		id, userID, codeHash, expiresAt.UTC().Format("2006-01-02 15:04:05"),
	)
	if err != nil {
		return fmt.Errorf("create verification code: %w", err)
	}
	return nil
}

func (d *DB) GetVerificationCode(userID string) (*VerificationCode, error) {
	vc := &VerificationCode{}
	// Use SQL to compute expiry so we don't depend on Go parsing the datetime format
	err := d.QueryRow(
		`SELECT id, user_id, code_hash, (expires_at < datetime('now')), attempts, created_at FROM verification_codes WHERE user_id = ?`,
		userID,
	).Scan(&vc.ID, &vc.UserID, &vc.CodeHash, &vc.Expired, &vc.Attempts, &vc.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get verification code: %w", err)
	}
	return vc, nil
}

func (d *DB) IncrementVerificationAttempts(id string) error {
	_, err := d.Exec(`UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("increment verification attempts: %w", err)
	}
	return nil
}

func (d *DB) InvalidateVerificationCode(id string) error {
	_, err := d.Exec(`DELETE FROM verification_codes WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("invalidate verification code: %w", err)
	}
	return nil
}

func (d *DB) CountRecentVerificationCodes(userID string, since time.Time) (int, error) {
	var count int
	err := d.QueryRow(
		`SELECT COUNT(*) FROM verification_codes WHERE user_id = ? AND created_at >= ?`,
		userID, since.UTC().Format("2006-01-02 15:04:05"),
	).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count recent verification codes: %w", err)
	}
	return count, nil
}

func (d *DB) ExpireVerificationCodeByUserID(userID string) error {
	_, err := d.Exec(
		`UPDATE verification_codes SET expires_at = datetime('now', '-1 hour') WHERE user_id = ?`,
		userID,
	)
	if err != nil {
		return fmt.Errorf("expire verification code: %w", err)
	}
	return nil
}

func (d *DB) GetVerificationCodeHash(userID string) (string, error) {
	var hash string
	err := d.QueryRow(`SELECT code_hash FROM verification_codes WHERE user_id = ?`, userID).Scan(&hash)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("get verification code hash: %w", err)
	}
	return hash, nil
}
