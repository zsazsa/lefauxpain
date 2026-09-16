package api

import (
	"log"

	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/storage"
)

// removeFileIfUnreferenced deletes relPath from disk only when no attachment,
// media item or radio track still points at it. Storage is content-addressed,
// so identical uploads share one file and the last reference owns it.
func removeFileIfUnreferenced(database *db.DB, store *storage.FileStore, relPath string) {
	n, err := database.CountFileReferences(relPath)
	if err != nil {
		log.Printf("count file references %q: %v", relPath, err)
		return
	}
	if n == 0 {
		store.RemoveFile(relPath)
	}
}
