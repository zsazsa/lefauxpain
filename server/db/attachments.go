package db

import "fmt"

type Attachment struct {
	ID        string  `json:"id"`
	MessageID *string `json:"message_id"`
	Filename  string  `json:"filename"`
	Path      string  `json:"path"`
	ThumbPath *string `json:"thumb_path"`
	SizeBytes int64   `json:"size_bytes"`
	MimeType  string  `json:"mime_type"`
	Width     *int    `json:"width"`
	Height    *int    `json:"height"`
	CreatedAt string  `json:"created_at"`
}

func (d *DB) CreateAttachment(a *Attachment) error {
	_, err := d.Exec(
		`INSERT INTO attachments (id, message_id, filename, path, thumb_path, size_bytes, mime_type, width, height)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		a.ID, a.MessageID, a.Filename, a.Path, a.ThumbPath, a.SizeBytes, a.MimeType, a.Width, a.Height,
	)
	if err != nil {
		return fmt.Errorf("create attachment: %w", err)
	}
	return nil
}

func (d *DB) LinkAttachmentsToMessage(messageID string, attachmentIDs []string) error {
	for _, aid := range attachmentIDs {
		_, err := d.Exec(
			`UPDATE attachments SET message_id = ? WHERE id = ? AND message_id IS NULL`,
			messageID, aid,
		)
		if err != nil {
			return fmt.Errorf("link attachment %s: %w", aid, err)
		}
	}
	return nil
}

func (d *DB) GetAttachmentsByMessage(messageID string) ([]Attachment, error) {
	rows, err := d.Query(
		`SELECT id, message_id, filename, path, thumb_path, size_bytes, mime_type, width, height, created_at
		 FROM attachments WHERE message_id = ?`, messageID,
	)
	if err != nil {
		return nil, fmt.Errorf("get attachments: %w", err)
	}
	defer rows.Close()

	var attachments []Attachment
	for rows.Next() {
		var a Attachment
		if err := rows.Scan(&a.ID, &a.MessageID, &a.Filename, &a.Path, &a.ThumbPath,
			&a.SizeBytes, &a.MimeType, &a.Width, &a.Height, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan attachment: %w", err)
		}
		attachments = append(attachments, a)
	}
	if attachments == nil {
		attachments = []Attachment{}
	}
	return attachments, rows.Err()
}

func (d *DB) CleanupOrphanedAttachments() ([]Attachment, error) {
	rows, err := d.Query(
		`SELECT id, path, thumb_path FROM attachments
		 WHERE message_id IS NULL AND created_at < datetime('now', '-1 hour')`,
	)
	if err != nil {
		return nil, fmt.Errorf("query orphans: %w", err)
	}
	defer rows.Close()

	var orphans []Attachment
	for rows.Next() {
		var a Attachment
		if err := rows.Scan(&a.ID, &a.Path, &a.ThumbPath); err != nil {
			return nil, fmt.Errorf("scan orphan: %w", err)
		}
		orphans = append(orphans, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	_, err = d.Exec(
		`DELETE FROM attachments WHERE message_id IS NULL AND created_at < datetime('now', '-1 hour')`,
	)
	if err != nil {
		return nil, fmt.Errorf("delete orphans: %w", err)
	}

	return orphans, nil
}
