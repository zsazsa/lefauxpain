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
