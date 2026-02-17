package db

type MediaItem struct {
	ID         string `json:"id"`
	Filename   string `json:"filename"`
	Path       string `json:"path"`
	MimeType   string `json:"mime_type"`
	SizeBytes  int64  `json:"size_bytes"`
	UploadedBy string `json:"uploaded_by"`
	CreatedAt  string `json:"created_at"`
}

func (d *DB) CreateMediaItem(m *MediaItem) error {
	_, err := d.Exec(
		`INSERT INTO media (id, filename, path, mime_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)`,
		m.ID, m.Filename, m.Path, m.MimeType, m.SizeBytes, m.UploadedBy,
	)
	return err
}

func (d *DB) GetAllMedia() ([]MediaItem, error) {
	rows, err := d.Query(`SELECT id, filename, path, mime_type, size_bytes, uploaded_by, created_at FROM media ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []MediaItem
	for rows.Next() {
		var m MediaItem
		if err := rows.Scan(&m.ID, &m.Filename, &m.Path, &m.MimeType, &m.SizeBytes, &m.UploadedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	if items == nil {
		items = []MediaItem{}
	}
	return items, nil
}

func (d *DB) GetMediaByID(id string) (*MediaItem, error) {
	var m MediaItem
	err := d.QueryRow(
		`SELECT id, filename, path, mime_type, size_bytes, uploaded_by, created_at FROM media WHERE id = ?`, id,
	).Scan(&m.ID, &m.Filename, &m.Path, &m.MimeType, &m.SizeBytes, &m.UploadedBy, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (d *DB) DeleteMedia(id string) error {
	_, err := d.Exec(`DELETE FROM media WHERE id = ?`, id)
	return err
}
