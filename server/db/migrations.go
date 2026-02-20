package db

import "fmt"

var migrations = []string{
	// Version 1: Initial schema
	`CREATE TABLE IF NOT EXISTS schema_version (
		version INTEGER PRIMARY KEY
	);

	CREATE TABLE users (
		id          TEXT PRIMARY KEY,
		username    TEXT NOT NULL UNIQUE,
		password_hash TEXT,
		is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
		avatar_path TEXT,
		created_at  DATETIME DEFAULT (datetime('now'))
	);

	CREATE TABLE tokens (
		token       TEXT PRIMARY KEY,
		user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at  DATETIME DEFAULT (datetime('now')),
		expires_at  DATETIME
	);
	CREATE INDEX idx_tokens_user ON tokens(user_id);
	CREATE INDEX idx_tokens_expires ON tokens(expires_at);

	CREATE TABLE channels (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		type        TEXT NOT NULL CHECK(type IN ('voice', 'text')),
		position    INTEGER NOT NULL,
		created_at  DATETIME DEFAULT (datetime('now'))
	);

	CREATE TABLE messages (
		id          TEXT PRIMARY KEY,
		channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
		author_id   TEXT NOT NULL REFERENCES users(id),
		content     TEXT CHECK(content IS NULL OR length(content) <= 4000),
		reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
		created_at  DATETIME DEFAULT (datetime('now')),
		edited_at   DATETIME
	);
	CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);

	CREATE TABLE reactions (
		message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		emoji       TEXT NOT NULL,
		created_at  DATETIME DEFAULT (datetime('now')),
		PRIMARY KEY (message_id, user_id, emoji)
	);
	CREATE INDEX idx_reactions_message ON reactions(message_id);

	CREATE TABLE attachments (
		id          TEXT PRIMARY KEY,
		message_id  TEXT REFERENCES messages(id) ON DELETE CASCADE,
		filename    TEXT NOT NULL,
		path        TEXT NOT NULL,
		thumb_path  TEXT,
		size_bytes  INTEGER NOT NULL,
		mime_type   TEXT NOT NULL,
		width       INTEGER,
		height      INTEGER,
		created_at  DATETIME DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_attachments_message ON attachments(message_id);
	CREATE INDEX idx_attachments_orphan ON attachments(message_id, created_at) WHERE message_id IS NULL;

	CREATE TABLE mentions (
		message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		PRIMARY KEY (message_id, user_id)
	);
	CREATE INDEX idx_mentions_user ON mentions(user_id);

	CREATE TABLE channel_reads (
		user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
		last_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
		updated_at  DATETIME DEFAULT (datetime('now')),
		PRIMARY KEY (user_id, channel_id)
	);`,

	// Version 2: Notifications
	`CREATE TABLE IF NOT EXISTS notifications (
		id          TEXT PRIMARY KEY,
		user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
		author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		read        BOOLEAN NOT NULL DEFAULT FALSE,
		created_at  DATETIME DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);`,

	// Version 3: Nullable author_id on messages (ON DELETE SET NULL for user deletion)
	`CREATE TABLE messages_new (
		id          TEXT PRIMARY KEY,
		channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
		author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
		content     TEXT CHECK(content IS NULL OR length(content) <= 4000),
		reply_to_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
		created_at  DATETIME DEFAULT (datetime('now')),
		edited_at   DATETIME
	);
	INSERT INTO messages_new SELECT * FROM messages;
	DROP TABLE messages;
	ALTER TABLE messages_new RENAME TO messages;
	CREATE INDEX idx_messages_channel_time ON messages(channel_id, created_at DESC);`,

	// Version 4: Admin approval system ("Knock Knock")
	`ALTER TABLE users ADD COLUMN approved BOOLEAN NOT NULL DEFAULT TRUE;
	ALTER TABLE users ADD COLUMN knock_message TEXT;`,

	// Version 5: Media library for synchronized video playback
	`CREATE TABLE media (
		id          TEXT PRIMARY KEY,
		filename    TEXT NOT NULL,
		path        TEXT NOT NULL,
		mime_type   TEXT NOT NULL,
		size_bytes  INTEGER NOT NULL,
		uploaded_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at  DATETIME DEFAULT (datetime('now'))
	);`,

	// Version 6: Soft delete for messages
	`ALTER TABLE messages ADD COLUMN deleted_at DATETIME;`,

	// Version 7: Channel managers and soft-delete channels
	`ALTER TABLE channels ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
	ALTER TABLE channels ADD COLUMN deleted_at DATETIME;

	CREATE TABLE channel_managers (
		channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		PRIMARY KEY (channel_id, user_id)
	);
	CREATE INDEX idx_channel_managers_user ON channel_managers(user_id);`,

	// Version 8: Radio stations and playlists
	`CREATE TABLE radio_stations (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
		position    INTEGER NOT NULL,
		created_at  DATETIME DEFAULT (datetime('now'))
	);

	CREATE TABLE radio_playlists (
		id          TEXT PRIMARY KEY,
		name        TEXT NOT NULL,
		user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		created_at  DATETIME DEFAULT (datetime('now'))
	);

	CREATE TABLE radio_tracks (
		id          TEXT PRIMARY KEY,
		playlist_id TEXT NOT NULL REFERENCES radio_playlists(id) ON DELETE CASCADE,
		filename    TEXT NOT NULL,
		path        TEXT NOT NULL,
		mime_type   TEXT NOT NULL,
		size_bytes  INTEGER NOT NULL,
		duration    REAL,
		position    INTEGER NOT NULL,
		created_at  DATETIME DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_radio_tracks_playlist ON radio_tracks(playlist_id, position);`,

	// Version 9: Notifications → generic type + JSON data column
	`CREATE TABLE notifications_new (
		id         TEXT PRIMARY KEY,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		type       TEXT NOT NULL,
		data       TEXT NOT NULL DEFAULT '{}',
		read       BOOLEAN NOT NULL DEFAULT FALSE,
		created_at DATETIME DEFAULT (datetime('now'))
	);
	INSERT INTO notifications_new (id, user_id, type, data, read, created_at)
		SELECT id, user_id, 'mention',
		       json_object('message_id', message_id, 'channel_id', channel_id, 'author_id', author_id),
		       read, created_at
		FROM notifications;
	DROP TABLE notifications;
	ALTER TABLE notifications_new RENAME TO notifications;
	CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);`,

	// Version 10: Associate playlists with radio stations
	`ALTER TABLE radio_playlists ADD COLUMN station_id TEXT REFERENCES radio_stations(id) ON DELETE CASCADE;`,

	// Version 11: Radio station managers
	`CREATE TABLE radio_station_managers (
		station_id TEXT NOT NULL REFERENCES radio_stations(id) ON DELETE CASCADE,
		user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		PRIMARY KEY (station_id, user_id)
	);
	CREATE INDEX idx_radio_station_managers_user ON radio_station_managers(user_id);`,

	// Version 12: Per-station playback mode
	`ALTER TABLE radio_stations ADD COLUMN playback_mode TEXT NOT NULL DEFAULT 'play_all';`,

	// Version 13: Pre-computed waveform peaks for radio tracks
	`ALTER TABLE radio_tracks ADD COLUMN waveform TEXT;`,

	// Version 14: Email verification
	`ALTER TABLE users ADD COLUMN email TEXT;
	ALTER TABLE users ADD COLUMN email_verified_at DATETIME;

	CREATE TABLE IF NOT EXISTS verification_codes (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		code_hash TEXT NOT NULL,
		expires_at DATETIME NOT NULL,
		attempts INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME NOT NULL DEFAULT (datetime('now'))
	);
	CREATE UNIQUE INDEX idx_verification_codes_user ON verification_codes(user_id);

	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_nocase
		ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;`,

	// Version 15: Registration IP tracking
	`ALTER TABLE users ADD COLUMN register_ip TEXT;`,

	// Version 16: URL unfurls for link previews
	`CREATE TABLE url_unfurls (
		id           TEXT PRIMARY KEY,
		message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
		url          TEXT NOT NULL,
		site_name    TEXT,
		title        TEXT,
		description  TEXT,
		image_url    TEXT,
		fetch_status TEXT NOT NULL DEFAULT 'pending',
		fetched_at   DATETIME DEFAULT (datetime('now'))
	);
	CREATE INDEX idx_url_unfurls_message ON url_unfurls(message_id);`,
}

func (d *DB) migrate() error {
	// Ensure schema_version table exists
	_, err := d.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`)
	if err != nil {
		return fmt.Errorf("create schema_version: %w", err)
	}

	var currentVersion int
	row := d.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`)
	if err := row.Scan(&currentVersion); err != nil {
		return fmt.Errorf("get schema version: %w", err)
	}

	for i := currentVersion; i < len(migrations); i++ {
		version := i + 1

		// Disable FK checks during migrations (needed for table recreation)
		if _, err := d.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
			return fmt.Errorf("disable fk migration %d: %w", version, err)
		}

		tx, err := d.Begin()
		if err != nil {
			d.Exec(`PRAGMA foreign_keys=ON`)
			return fmt.Errorf("begin migration %d: %w", version, err)
		}

		if _, err := tx.Exec(migrations[i]); err != nil {
			tx.Rollback()
			d.Exec(`PRAGMA foreign_keys=ON`)
			return fmt.Errorf("run migration %d: %w", version, err)
		}

		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (?)`, version); err != nil {
			tx.Rollback()
			d.Exec(`PRAGMA foreign_keys=ON`)
			return fmt.Errorf("record migration %d: %w", version, err)
		}

		if err := tx.Commit(); err != nil {
			d.Exec(`PRAGMA foreign_keys=ON`)
			return fmt.Errorf("commit migration %d: %w", version, err)
		}

		if _, err := d.Exec(`PRAGMA foreign_keys=ON`); err != nil {
			return fmt.Errorf("enable fk migration %d: %w", version, err)
		}
	}

	return nil
}
