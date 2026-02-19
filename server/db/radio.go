package db

import "fmt"

type RadioStation struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	CreatedBy    *string `json:"created_by"`
	Position     int     `json:"position"`
	PlaybackMode string  `json:"playback_mode"`
	CreatedAt    string  `json:"created_at"`
}

type RadioPlaylist struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	UserID    string  `json:"user_id"`
	StationID *string `json:"station_id"`
	CreatedAt string  `json:"created_at"`
}

type RadioTrack struct {
	ID         string  `json:"id"`
	PlaylistID string  `json:"playlist_id"`
	Filename   string  `json:"filename"`
	Path       string  `json:"path"`
	MimeType   string  `json:"mime_type"`
	SizeBytes  int64   `json:"size_bytes"`
	Duration   float64 `json:"duration"`
	Position   int     `json:"position"`
	Waveform   *string `json:"waveform"`
	CreatedAt  string  `json:"created_at"`
}

// --- Station CRUD ---

func (d *DB) CreateRadioStation(id, name, createdBy string) (*RadioStation, error) {
	var maxPos *int
	err := d.QueryRow(`SELECT MAX(position) FROM radio_stations`).Scan(&maxPos)
	if err != nil {
		return nil, fmt.Errorf("get max station position: %w", err)
	}
	pos := 0
	if maxPos != nil {
		pos = *maxPos + 1
	}

	tx, err := d.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin create radio station: %w", err)
	}

	_, err = tx.Exec(
		`INSERT INTO radio_stations (id, name, created_by, position) VALUES (?, ?, ?, ?)`,
		id, name, createdBy, pos,
	)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("create radio station: %w", err)
	}

	// Auto-add creator as manager
	_, err = tx.Exec(
		`INSERT OR IGNORE INTO radio_station_managers (station_id, user_id) VALUES (?, ?)`,
		id, createdBy,
	)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("add station creator as manager: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create radio station: %w", err)
	}

	return &RadioStation{ID: id, Name: name, CreatedBy: &createdBy, Position: pos}, nil
}

func (d *DB) DeleteRadioStation(id string) error {
	_, err := d.Exec(`DELETE FROM radio_stations WHERE id = ?`, id)
	return err
}

func (d *DB) GetAllRadioStations() ([]RadioStation, error) {
	rows, err := d.Query(`SELECT id, name, created_by, position, playback_mode, created_at FROM radio_stations ORDER BY position`)
	if err != nil {
		return nil, fmt.Errorf("get radio stations: %w", err)
	}
	defer rows.Close()

	var stations []RadioStation
	for rows.Next() {
		var s RadioStation
		if err := rows.Scan(&s.ID, &s.Name, &s.CreatedBy, &s.Position, &s.PlaybackMode, &s.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan radio station: %w", err)
		}
		stations = append(stations, s)
	}
	if stations == nil {
		stations = []RadioStation{}
	}
	return stations, rows.Err()
}

func (d *DB) GetRadioStationByID(id string) (*RadioStation, error) {
	var s RadioStation
	err := d.QueryRow(
		`SELECT id, name, created_by, position, playback_mode, created_at FROM radio_stations WHERE id = ?`, id,
	).Scan(&s.ID, &s.Name, &s.CreatedBy, &s.Position, &s.PlaybackMode, &s.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (d *DB) UpdateRadioStationName(id, name string) error {
	_, err := d.Exec(`UPDATE radio_stations SET name = ? WHERE id = ?`, name, id)
	return err
}

func (d *DB) UpdateRadioStationPlaybackMode(id, mode string) error {
	_, err := d.Exec(`UPDATE radio_stations SET playback_mode = ? WHERE id = ?`, mode, id)
	return err
}

func (d *DB) GetPlaylistsByStation(stationID string) ([]RadioPlaylist, error) {
	rows, err := d.Query(
		`SELECT id, name, user_id, station_id, created_at FROM radio_playlists WHERE station_id = ? ORDER BY created_at`,
		stationID,
	)
	if err != nil {
		return nil, fmt.Errorf("get playlists by station: %w", err)
	}
	defer rows.Close()

	var playlists []RadioPlaylist
	for rows.Next() {
		var p RadioPlaylist
		if err := rows.Scan(&p.ID, &p.Name, &p.UserID, &p.StationID, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan playlist: %w", err)
		}
		playlists = append(playlists, p)
	}
	if playlists == nil {
		playlists = []RadioPlaylist{}
	}
	return playlists, rows.Err()
}

// --- Playlist CRUD ---

func (d *DB) CreateRadioPlaylist(id, name, userID string, stationID *string) (*RadioPlaylist, error) {
	_, err := d.Exec(
		`INSERT INTO radio_playlists (id, name, user_id, station_id) VALUES (?, ?, ?, ?)`,
		id, name, userID, stationID,
	)
	if err != nil {
		return nil, fmt.Errorf("create radio playlist: %w", err)
	}
	return &RadioPlaylist{ID: id, Name: name, UserID: userID, StationID: stationID}, nil
}

func (d *DB) DeleteRadioPlaylist(id string) error {
	_, err := d.Exec(`DELETE FROM radio_playlists WHERE id = ?`, id)
	return err
}

func (d *DB) GetAllPlaylists() ([]RadioPlaylist, error) {
	rows, err := d.Query(
		`SELECT id, name, user_id, station_id, created_at FROM radio_playlists ORDER BY created_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("get all playlists: %w", err)
	}
	defer rows.Close()

	var playlists []RadioPlaylist
	for rows.Next() {
		var p RadioPlaylist
		if err := rows.Scan(&p.ID, &p.Name, &p.UserID, &p.StationID, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan playlist: %w", err)
		}
		playlists = append(playlists, p)
	}
	if playlists == nil {
		playlists = []RadioPlaylist{}
	}
	return playlists, rows.Err()
}

func (d *DB) GetPlaylistsByUser(userID string) ([]RadioPlaylist, error) {
	rows, err := d.Query(
		`SELECT id, name, user_id, station_id, created_at FROM radio_playlists WHERE user_id = ? ORDER BY created_at`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("get playlists by user: %w", err)
	}
	defer rows.Close()

	var playlists []RadioPlaylist
	for rows.Next() {
		var p RadioPlaylist
		if err := rows.Scan(&p.ID, &p.Name, &p.UserID, &p.StationID, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan playlist: %w", err)
		}
		playlists = append(playlists, p)
	}
	if playlists == nil {
		playlists = []RadioPlaylist{}
	}
	return playlists, rows.Err()
}

func (d *DB) GetPlaylistByID(id string) (*RadioPlaylist, error) {
	var p RadioPlaylist
	err := d.QueryRow(
		`SELECT id, name, user_id, station_id, created_at FROM radio_playlists WHERE id = ?`, id,
	).Scan(&p.ID, &p.Name, &p.UserID, &p.StationID, &p.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// --- Track CRUD ---

func (d *DB) CreateRadioTrack(t *RadioTrack) error {
	// Get next position
	var maxPos *int
	err := d.QueryRow(`SELECT MAX(position) FROM radio_tracks WHERE playlist_id = ?`, t.PlaylistID).Scan(&maxPos)
	if err != nil {
		return fmt.Errorf("get max track position: %w", err)
	}
	pos := 0
	if maxPos != nil {
		pos = *maxPos + 1
	}
	t.Position = pos

	_, err = d.Exec(
		`INSERT INTO radio_tracks (id, playlist_id, filename, path, mime_type, size_bytes, duration, position, waveform) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		t.ID, t.PlaylistID, t.Filename, t.Path, t.MimeType, t.SizeBytes, t.Duration, t.Position, t.Waveform,
	)
	return err
}

func (d *DB) DeleteRadioTrack(id string) error {
	_, err := d.Exec(`DELETE FROM radio_tracks WHERE id = ?`, id)
	return err
}

func (d *DB) GetTracksByPlaylist(playlistID string) ([]RadioTrack, error) {
	rows, err := d.Query(
		`SELECT id, playlist_id, filename, path, mime_type, size_bytes, duration, position, waveform, created_at FROM radio_tracks WHERE playlist_id = ? ORDER BY position`,
		playlistID,
	)
	if err != nil {
		return nil, fmt.Errorf("get tracks by playlist: %w", err)
	}
	defer rows.Close()

	var tracks []RadioTrack
	for rows.Next() {
		var t RadioTrack
		if err := rows.Scan(&t.ID, &t.PlaylistID, &t.Filename, &t.Path, &t.MimeType, &t.SizeBytes, &t.Duration, &t.Position, &t.Waveform, &t.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan track: %w", err)
		}
		tracks = append(tracks, t)
	}
	if tracks == nil {
		tracks = []RadioTrack{}
	}
	return tracks, rows.Err()
}

func (d *DB) GetTrackByID(id string) (*RadioTrack, error) {
	var t RadioTrack
	err := d.QueryRow(
		`SELECT id, playlist_id, filename, path, mime_type, size_bytes, duration, position, waveform, created_at FROM radio_tracks WHERE id = ?`, id,
	).Scan(&t.ID, &t.PlaylistID, &t.Filename, &t.Path, &t.MimeType, &t.SizeBytes, &t.Duration, &t.Position, &t.Waveform, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (d *DB) ReorderRadioTracks(playlistID string, trackIDs []string) error {
	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("begin reorder tracks: %w", err)
	}
	for i, id := range trackIDs {
		if _, err := tx.Exec(`UPDATE radio_tracks SET position = ? WHERE id = ? AND playlist_id = ?`, i, id, playlistID); err != nil {
			tx.Rollback()
			return fmt.Errorf("reorder track %s: %w", id, err)
		}
	}
	return tx.Commit()
}

// --- Radio station manager CRUD ---

func (d *DB) AddRadioStationManager(stationID, userID string) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO radio_station_managers (station_id, user_id) VALUES (?, ?)`,
		stationID, userID,
	)
	if err != nil {
		return fmt.Errorf("add radio station manager: %w", err)
	}
	return nil
}

func (d *DB) RemoveRadioStationManager(stationID, userID string) error {
	_, err := d.Exec(
		`DELETE FROM radio_station_managers WHERE station_id = ? AND user_id = ?`,
		stationID, userID,
	)
	if err != nil {
		return fmt.Errorf("remove radio station manager: %w", err)
	}
	return nil
}

func (d *DB) GetRadioStationManagers(stationID string) ([]string, error) {
	rows, err := d.Query(`SELECT user_id FROM radio_station_managers WHERE station_id = ?`, stationID)
	if err != nil {
		return nil, fmt.Errorf("get radio station managers: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan radio station manager: %w", err)
		}
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, rows.Err()
}

func (d *DB) IsRadioStationManager(stationID, userID string) (bool, error) {
	var count int
	err := d.QueryRow(
		`SELECT COUNT(*) FROM radio_station_managers WHERE station_id = ? AND user_id = ?`,
		stationID, userID,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check radio station manager: %w", err)
	}
	return count > 0, nil
}

func (d *DB) GetAllRadioStationManagers() (map[string][]string, error) {
	rows, err := d.Query(`SELECT station_id, user_id FROM radio_station_managers`)
	if err != nil {
		return nil, fmt.Errorf("get all radio station managers: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]string)
	for rows.Next() {
		var stationID, userID string
		if err := rows.Scan(&stationID, &userID); err != nil {
			return nil, fmt.Errorf("scan radio station manager: %w", err)
		}
		result[stationID] = append(result[stationID], userID)
	}
	return result, rows.Err()
}
