package db

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
)

type Document struct {
	ID        string  `json:"id"`
	ChannelID string  `json:"channel_id"`
	Path      string  `json:"path"`
	Content   string  `json:"content"`
	CreatedBy *string `json:"created_by"`
	UpdatedBy *string `json:"updated_by"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

type DocumentMeta struct {
	ID        string  `json:"id"`
	Path      string  `json:"path"`
	CreatedBy *string `json:"created_by"`
	UpdatedBy *string `json:"updated_by"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

// ListDocuments returns metadata for all documents in a channel, optionally filtered by path prefix.
func (d *DB) ListDocuments(channelID, prefix string) ([]DocumentMeta, error) {
	var rows *sql.Rows
	var err error

	if prefix != "" {
		rows, err = d.Query(
			`SELECT id, path, created_by, updated_by, created_at, updated_at
			 FROM documents WHERE channel_id = ? AND path LIKE ? || '%'
			 ORDER BY path ASC`,
			channelID, prefix,
		)
	} else {
		rows, err = d.Query(
			`SELECT id, path, created_by, updated_by, created_at, updated_at
			 FROM documents WHERE channel_id = ?
			 ORDER BY path ASC`,
			channelID,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	defer rows.Close()

	var docs []DocumentMeta
	for rows.Next() {
		var doc DocumentMeta
		if err := rows.Scan(&doc.ID, &doc.Path, &doc.CreatedBy, &doc.UpdatedBy, &doc.CreatedAt, &doc.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan document: %w", err)
		}
		docs = append(docs, doc)
	}
	return docs, nil
}

// GetDocument returns a document by channel and path.
func (d *DB) GetDocument(channelID, path string) (*Document, error) {
	doc := &Document{}
	err := d.QueryRow(
		`SELECT id, channel_id, path, content, created_by, updated_by, created_at, updated_at
		 FROM documents WHERE channel_id = ? AND path = ?`,
		channelID, path,
	).Scan(&doc.ID, &doc.ChannelID, &doc.Path, &doc.Content, &doc.CreatedBy, &doc.UpdatedBy, &doc.CreatedAt, &doc.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get document: %w", err)
	}
	return doc, nil
}

// PutDocument creates or updates a document. Returns the document.
func (d *DB) PutDocument(channelID, path, content, userID string) (*Document, error) {
	existing, err := d.GetDocument(channelID, path)
	if err != nil {
		return nil, err
	}

	if existing != nil {
		// Update
		_, err := d.Exec(
			`UPDATE documents SET content = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
			content, userID, existing.ID,
		)
		if err != nil {
			return nil, fmt.Errorf("update document: %w", err)
		}
		return d.GetDocument(channelID, path)
	}

	// Create
	id := uuid.New().String()
	_, err = d.Exec(
		`INSERT INTO documents (id, channel_id, path, content, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?)`,
		id, channelID, path, content, userID, userID,
	)
	if err != nil {
		return nil, fmt.Errorf("create document: %w", err)
	}
	return d.GetDocument(channelID, path)
}

// DeleteDocument removes a document by channel and path.
func (d *DB) DeleteDocument(channelID, path string) error {
	result, err := d.Exec(`DELETE FROM documents WHERE channel_id = ? AND path = ?`, channelID, path)
	if err != nil {
		return fmt.Errorf("delete document: %w", err)
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("document not found")
	}
	return nil
}
