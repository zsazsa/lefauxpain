package db

import (
	"database/sql"
	"fmt"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
}

func Open(dataDir string) (*DB, error) {
	dbPath := filepath.Join(dataDir, "voicechat.db")
	sqlDB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// SQLite serializes writes; one conn avoids SQLITE_BUSY
	sqlDB.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA synchronous=NORMAL",
	}
	for _, p := range pragmas {
		if _, err := sqlDB.Exec(p); err != nil {
			sqlDB.Close()
			return nil, fmt.Errorf("set pragma %q: %w", p, err)
		}
	}

	d := &DB{sqlDB}
	if err := d.migrate(); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	return d, nil
}
