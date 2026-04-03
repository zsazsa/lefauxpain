package db

import (
	"database/sql"
	"fmt"

	"github.com/google/uuid"
)

func (d *DB) CreateChannel(id, name, chType, createdBy string) (*Channel, error) {
	var maxPos *int
	err := d.QueryRow(`SELECT MAX(position) FROM channels WHERE deleted_at IS NULL`).Scan(&maxPos)
	if err != nil {
		return nil, fmt.Errorf("get max position: %w", err)
	}
	pos := 0
	if maxPos != nil {
		pos = *maxPos + 1
	}

	tx, err := d.Begin()
	if err != nil {
		return nil, fmt.Errorf("begin create channel: %w", err)
	}

	_, err = tx.Exec(
		`INSERT INTO channels (id, name, type, position, created_by, visibility) VALUES (?, ?, ?, ?, ?, 'public')`,
		id, name, chType, pos, createdBy,
	)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("create channel: %w", err)
	}

	// Auto-add creator as channel member with owner role
	_, err = tx.Exec(
		`INSERT INTO channel_members (channel_id, user_id, role) VALUES (?, ?, 'owner')`,
		id, createdBy,
	)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("add creator as member: %w", err)
	}

	// Also add to channel_managers for backward compatibility
	_, err = tx.Exec(
		`INSERT OR IGNORE INTO channel_managers (channel_id, user_id) VALUES (?, ?)`,
		id, createdBy,
	)
	if err != nil {
		tx.Rollback()
		return nil, fmt.Errorf("add creator as manager: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create channel: %w", err)
	}

	cb := createdBy
	return &Channel{ID: id, Name: name, Type: chType, Position: pos, Visibility: "public", CreatedBy: &cb}, nil
}

func (d *DB) DeleteChannel(id string) error {
	res, err := d.Exec(`UPDATE channels SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("soft delete channel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("channel not found")
	}
	return nil
}

func (d *DB) RenameChannel(id, name string) error {
	res, err := d.Exec(`UPDATE channels SET name = ? WHERE id = ? AND deleted_at IS NULL`, name, id)
	if err != nil {
		return fmt.Errorf("rename channel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("channel not found")
	}
	return nil
}

func (d *DB) RestoreChannel(id string) error {
	res, err := d.Exec(`UPDATE channels SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`, id)
	if err != nil {
		return fmt.Errorf("restore channel: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("channel not found or not deleted")
	}
	return nil
}

func (d *DB) GetDeletedChannels() ([]Channel, error) {
	rows, err := d.Query(`SELECT id, name, type, position, visibility, description, created_by, deleted_at, created_at FROM channels WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("get deleted channels: %w", err)
	}
	defer rows.Close()

	var channels []Channel
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.Visibility, &c.Description, &c.CreatedBy, &c.DeletedAt, &c.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan deleted channel: %w", err)
		}
		channels = append(channels, c)
	}
	if channels == nil {
		channels = []Channel{}
	}
	return channels, rows.Err()
}

func (d *DB) ReorderChannels(ids []string) error {
	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("begin reorder: %w", err)
	}
	for i, id := range ids {
		if _, err := tx.Exec(`UPDATE channels SET position = ? WHERE id = ? AND deleted_at IS NULL`, i, id); err != nil {
			tx.Rollback()
			return fmt.Errorf("reorder channel %s: %w", id, err)
		}
	}
	return tx.Commit()
}

func (d *DB) SeedDefaultChannels() error {
	defaults := []struct {
		name   string
		chType string
	}{
		{"lobby", "text"},
		{"General", "voice"},
	}
	for _, ch := range defaults {
		var exists int
		d.QueryRow(`SELECT COUNT(*) FROM channels WHERE name = ? AND type = ?`, ch.name, ch.chType).Scan(&exists)
		if exists > 0 {
			continue
		}
		// Use max position + 1
		var maxPos *int
		d.QueryRow(`SELECT MAX(position) FROM channels`).Scan(&maxPos)
		pos := 0
		if maxPos != nil {
			pos = *maxPos + 1
		}
		_, err := d.Exec(
			`INSERT INTO channels (id, name, type, position) VALUES (?, ?, ?, ?)`,
			uuid.New().String(), ch.name, ch.chType, pos,
		)
		if err != nil {
			return fmt.Errorf("seed channel %s: %w", ch.name, err)
		}
	}
	return nil
}

func (d *DB) GetChannelByID(id string) (*Channel, error) {
	c := &Channel{}
	err := d.QueryRow(
		`SELECT id, name, type, position, visibility, description, created_by, created_at FROM channels WHERE id = ? AND deleted_at IS NULL`, id,
	).Scan(&c.ID, &c.Name, &c.Type, &c.Position, &c.Visibility, &c.Description, &c.CreatedBy, &c.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("get channel: %w", err)
	}
	return c, nil
}

// Channel membership types

type ChannelMember struct {
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

type ChannelWithMembership struct {
	Channel
	IsMember bool   `json:"is_member"`
	Role     string `json:"role,omitempty"`
}

type AccessRequest struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id"`
	Username  string `json:"username"`
	Status    string `json:"status"`
	CreatedAt string `json:"created_at"`
}

// Channel membership CRUD

func (d *DB) AddChannelMember(channelID, userID, role string) error {
	_, err := d.Exec(
		`INSERT OR IGNORE INTO channel_members (channel_id, user_id, role) VALUES (?, ?, ?)`,
		channelID, userID, role,
	)
	if err != nil {
		return fmt.Errorf("add channel member: %w", err)
	}
	return nil
}

func (d *DB) RemoveChannelMember(channelID, userID string) error {
	_, err := d.Exec(
		`DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?`,
		channelID, userID,
	)
	if err != nil {
		return fmt.Errorf("remove channel member: %w", err)
	}
	return nil
}

func (d *DB) IsChannelMember(channelID, userID string) (bool, error) {
	var count int
	err := d.QueryRow(
		`SELECT COUNT(*) FROM channel_members WHERE channel_id = ? AND user_id = ?`,
		channelID, userID,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check channel member: %w", err)
	}
	return count > 0, nil
}

func (d *DB) GetChannelMembers(channelID string) ([]ChannelMember, error) {
	rows, err := d.Query(
		`SELECT cm.channel_id, cm.user_id, u.username, cm.role, cm.created_at
		 FROM channel_members cm
		 JOIN users u ON u.id = cm.user_id
		 WHERE cm.channel_id = ?
		 ORDER BY cm.created_at`, channelID,
	)
	if err != nil {
		return nil, fmt.Errorf("get channel members: %w", err)
	}
	defer rows.Close()

	var members []ChannelMember
	for rows.Next() {
		var m ChannelMember
		if err := rows.Scan(&m.ChannelID, &m.UserID, &m.Username, &m.Role, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan channel member: %w", err)
		}
		members = append(members, m)
	}
	if members == nil {
		members = []ChannelMember{}
	}
	return members, rows.Err()
}

func (d *DB) GetAllChannelMembers() (map[string][]ChannelMember, error) {
	rows, err := d.Query(
		`SELECT cm.channel_id, cm.user_id, u.username, cm.role, cm.created_at
		 FROM channel_members cm
		 JOIN users u ON u.id = cm.user_id
		 JOIN channels c ON c.id = cm.channel_id
		 WHERE c.deleted_at IS NULL
		 ORDER BY cm.created_at`,
	)
	if err != nil {
		return nil, fmt.Errorf("get all channel members: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]ChannelMember)
	for rows.Next() {
		var m ChannelMember
		if err := rows.Scan(&m.ChannelID, &m.UserID, &m.Username, &m.Role, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan channel member: %w", err)
		}
		result[m.ChannelID] = append(result[m.ChannelID], m)
	}
	return result, rows.Err()
}

func (d *DB) GetMemberRole(channelID, userID string) (string, error) {
	var role string
	err := d.QueryRow(
		`SELECT role FROM channel_members WHERE channel_id = ? AND user_id = ?`,
		channelID, userID,
	).Scan(&role)
	if err != nil {
		return "", fmt.Errorf("get member role: %w", err)
	}
	return role, nil
}

func (d *DB) SetMemberRole(channelID, userID, role string) error {
	_, err := d.Exec(
		`UPDATE channel_members SET role = ? WHERE channel_id = ? AND user_id = ?`,
		role, channelID, userID,
	)
	if err != nil {
		return fmt.Errorf("set member role: %w", err)
	}
	return nil
}

func (d *DB) GetChannelMemberIDs(channelID string) ([]string, error) {
	rows, err := d.Query(`SELECT user_id FROM channel_members WHERE channel_id = ?`, channelID)
	if err != nil {
		return nil, fmt.Errorf("get channel member ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan channel member id: %w", err)
		}
		ids = append(ids, id)
	}
	if ids == nil {
		ids = []string{}
	}
	return ids, rows.Err()
}

func (d *DB) CanAccessChannel(channelID, userID string, isAdmin bool) (bool, error) {
	if isAdmin {
		return true, nil
	}

	var visibility string
	err := d.QueryRow(`SELECT visibility FROM channels WHERE id = ? AND deleted_at IS NULL`, channelID).Scan(&visibility)
	if err != nil {
		return false, fmt.Errorf("get channel visibility: %w", err)
	}

	if visibility == "public" {
		return true, nil
	}

	// For visible and invisible channels, check membership
	return d.IsChannelMember(channelID, userID)
}

func (d *DB) GetChannelsForUser(userID string, isAdmin bool) ([]ChannelWithMembership, error) {
	var rows *sql.Rows
	var err error

	if isAdmin {
		rows, err = d.Query(
			`SELECT c.id, c.name, c.type, c.position, c.visibility, c.description, c.created_by, c.created_at,
			        CASE WHEN cm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_member,
			        COALESCE(cm.role, '') AS role
			 FROM channels c
			 LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
			 WHERE c.deleted_at IS NULL
			 ORDER BY c.position`, userID,
		)
	} else {
		rows, err = d.Query(
			`SELECT c.id, c.name, c.type, c.position, c.visibility, c.description, c.created_by, c.created_at,
			        CASE WHEN cm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_member,
			        COALESCE(cm.role, '') AS role
			 FROM channels c
			 LEFT JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = ?
			 WHERE c.deleted_at IS NULL
			   AND (c.visibility = 'public' OR c.visibility = 'visible' OR (c.visibility = 'invisible' AND cm.user_id IS NOT NULL))
			 ORDER BY c.position`, userID,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("get channels for user: %w", err)
	}
	defer rows.Close()

	var channels []ChannelWithMembership
	for rows.Next() {
		var cwm ChannelWithMembership
		var isMember int
		if err := rows.Scan(&cwm.ID, &cwm.Name, &cwm.Type, &cwm.Position, &cwm.Visibility, &cwm.Description, &cwm.CreatedBy, &cwm.CreatedAt, &isMember, &cwm.Role); err != nil {
			return nil, fmt.Errorf("scan channel for user: %w", err)
		}
		cwm.IsMember = isMember == 1
		channels = append(channels, cwm)
	}
	if channels == nil {
		channels = []ChannelWithMembership{}
	}
	return channels, rows.Err()
}

// Access request functions

func (d *DB) CreateAccessRequest(id, channelID, userID string) error {
	_, err := d.Exec(
		`INSERT INTO channel_access_requests (id, channel_id, user_id) VALUES (?, ?, ?)`,
		id, channelID, userID,
	)
	if err != nil {
		return fmt.Errorf("create access request: %w", err)
	}
	return nil
}

func (d *DB) GetPendingRequests(channelID string) ([]AccessRequest, error) {
	rows, err := d.Query(
		`SELECT r.id, r.channel_id, r.user_id, u.username, r.status, r.created_at
		 FROM channel_access_requests r
		 JOIN users u ON u.id = r.user_id
		 WHERE r.channel_id = ? AND r.status = 'pending'
		 ORDER BY r.created_at`, channelID,
	)
	if err != nil {
		return nil, fmt.Errorf("get pending requests: %w", err)
	}
	defer rows.Close()

	var requests []AccessRequest
	for rows.Next() {
		var r AccessRequest
		if err := rows.Scan(&r.ID, &r.ChannelID, &r.UserID, &r.Username, &r.Status, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan access request: %w", err)
		}
		requests = append(requests, r)
	}
	if requests == nil {
		requests = []AccessRequest{}
	}
	return requests, rows.Err()
}

func (d *DB) ApproveAccessRequest(requestID string) error {
	// Get request details
	var channelID, userID string
	err := d.QueryRow(
		`SELECT channel_id, user_id FROM channel_access_requests WHERE id = ? AND status = 'pending'`,
		requestID,
	).Scan(&channelID, &userID)
	if err != nil {
		return fmt.Errorf("get access request: %w", err)
	}

	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("begin approve request: %w", err)
	}

	_, err = tx.Exec(`UPDATE channel_access_requests SET status = 'approved' WHERE id = ?`, requestID)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("update access request: %w", err)
	}

	_, err = tx.Exec(
		`INSERT OR IGNORE INTO channel_members (channel_id, user_id, role) VALUES (?, ?, 'member')`,
		channelID, userID,
	)
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("add member from request: %w", err)
	}

	return tx.Commit()
}

func (d *DB) DenyAccessRequest(requestID string) error {
	_, err := d.Exec(
		`UPDATE channel_access_requests SET status = 'denied' WHERE id = ? AND status = 'pending'`,
		requestID,
	)
	if err != nil {
		return fmt.Errorf("deny access request: %w", err)
	}
	return nil
}

func (d *DB) HasPendingRequest(channelID, userID string) (bool, error) {
	var count int
	err := d.QueryRow(
		`SELECT COUNT(*) FROM channel_access_requests WHERE channel_id = ? AND user_id = ? AND status = 'pending'`,
		channelID, userID,
	).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check pending request: %w", err)
	}
	return count > 0, nil
}

// Backward-compatible manager functions (delegate to channel_members)

func (d *DB) AddChannelManager(channelID, userID string) error {
	return d.AddChannelMember(channelID, userID, "owner")
}

func (d *DB) RemoveChannelManager(channelID, userID string) error {
	return d.RemoveChannelMember(channelID, userID)
}

func (d *DB) GetChannelManagers(channelID string) ([]string, error) {
	return d.GetChannelMemberIDs(channelID)
}

func (d *DB) GetAllChannelManagers() (map[string][]string, error) {
	rows, err := d.Query(
		`SELECT cm.channel_id, cm.user_id
		 FROM channel_members cm
		 JOIN channels c ON c.id = cm.channel_id
		 WHERE c.deleted_at IS NULL`,
	)
	if err != nil {
		return nil, fmt.Errorf("get all channel managers: %w", err)
	}
	defer rows.Close()

	result := make(map[string][]string)
	for rows.Next() {
		var channelID, userID string
		if err := rows.Scan(&channelID, &userID); err != nil {
			return nil, fmt.Errorf("scan channel manager: %w", err)
		}
		result[channelID] = append(result[channelID], userID)
	}
	return result, rows.Err()
}

func (d *DB) IsChannelManager(channelID, userID string) (bool, error) {
	return d.IsChannelMember(channelID, userID)
}
