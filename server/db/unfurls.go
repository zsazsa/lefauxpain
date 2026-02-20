package db

import (
	"fmt"
	"strings"
)

type URLUnfurl struct {
	ID          string
	MessageID   string
	URL         string
	SiteName    *string
	Title       *string
	Description *string
	ImageURL    *string
	FetchStatus string
}

func (d *DB) CreateURLUnfurl(u *URLUnfurl) error {
	_, err := d.Exec(
		`INSERT INTO url_unfurls (id, message_id, url, site_name, title, description, image_url, fetch_status)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.MessageID, u.URL, u.SiteName, u.Title, u.Description, u.ImageURL, u.FetchStatus,
	)
	return err
}

func (d *DB) GetUnfurlsByMessageID(messageID string) ([]URLUnfurl, error) {
	rows, err := d.Query(
		`SELECT id, message_id, url, site_name, title, description, image_url, fetch_status
		 FROM url_unfurls WHERE message_id = ? AND fetch_status = 'success'`, messageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var unfurls []URLUnfurl
	for rows.Next() {
		var u URLUnfurl
		if err := rows.Scan(&u.ID, &u.MessageID, &u.URL, &u.SiteName, &u.Title, &u.Description, &u.ImageURL, &u.FetchStatus); err != nil {
			return nil, err
		}
		unfurls = append(unfurls, u)
	}
	return unfurls, nil
}

func (d *DB) GetUnfurlsByMessageIDs(messageIDs []string) (map[string][]URLUnfurl, error) {
	if len(messageIDs) == 0 {
		return map[string][]URLUnfurl{}, nil
	}

	placeholders := make([]string, len(messageIDs))
	args := make([]any, len(messageIDs))
	for i, id := range messageIDs {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(
		`SELECT id, message_id, url, site_name, title, description, image_url, fetch_status
		 FROM url_unfurls WHERE message_id IN (%s) AND fetch_status = 'success'`,
		strings.Join(placeholders, ","),
	)

	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string][]URLUnfurl{}
	for rows.Next() {
		var u URLUnfurl
		if err := rows.Scan(&u.ID, &u.MessageID, &u.URL, &u.SiteName, &u.Title, &u.Description, &u.ImageURL, &u.FetchStatus); err != nil {
			return nil, err
		}
		result[u.MessageID] = append(result[u.MessageID], u)
	}
	return result, nil
}
