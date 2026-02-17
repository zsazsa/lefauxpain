package api

import (
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/storage"
	"github.com/kalman/voicechat/ws"
)

type MediaHandler struct {
	DB      *db.DB
	Store   *storage.FileStore
	Hub     *ws.Hub
	MaxSize int64
}

type mediaResponse struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	URL       string `json:"url"`
	MimeType  string `json:"mime_type"`
	SizeBytes int64  `json:"size_bytes"`
	CreatedAt string `json:"created_at"`
}

func (h *MediaHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	userID := user.ID

	r.Body = http.MaxBytesReader(w, r.Body, h.MaxSize)
	if err := r.ParseMultipartForm(h.MaxSize); err != nil {
		writeError(w, http.StatusBadRequest, "file too large")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file")
		return
	}
	defer file.Close()

	mimeType, err := storage.DetectMIME(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "cannot read file")
		return
	}
	if !h.Store.IsVideoMIME(mimeType) {
		writeError(w, http.StatusBadRequest, "unsupported file type (video/mp4 or video/webm only)")
		return
	}

	relPath, err := h.Store.StoreVideo(file, mimeType)
	if err != nil {
		log.Printf("media upload store error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}

	mediaID := uuid.New().String()
	item := &db.MediaItem{
		ID:         mediaID,
		Filename:   header.Filename,
		Path:       relPath,
		MimeType:   mimeType,
		SizeBytes:  header.Size,
		UploadedBy: userID,
	}

	if err := h.DB.CreateMediaItem(item); err != nil {
		log.Printf("media upload db error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to save media")
		return
	}

	// Re-read to get created_at
	saved, _ := h.DB.GetMediaByID(mediaID)
	createdAt := ""
	if saved != nil {
		createdAt = saved.CreatedAt
	}

	url := "/" + strings.ReplaceAll(relPath, "\\", "/")
	resp := mediaResponse{
		ID:        mediaID,
		Filename:  header.Filename,
		URL:       url,
		MimeType:  mimeType,
		SizeBytes: header.Size,
		CreatedAt: createdAt,
	}

	// Broadcast media_added to all clients
	msg, err := ws.NewMessage("media_added", resp)
	if err == nil {
		h.Hub.BroadcastAll(msg)
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *MediaHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Extract ID from /api/v1/media/{id}
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		writeError(w, http.StatusBadRequest, "missing media id")
		return
	}
	mediaID := parts[len(parts)-1]

	item, err := h.DB.GetMediaByID(mediaID)
	if err != nil {
		writeError(w, http.StatusNotFound, "media not found")
		return
	}

	// Remove file from disk
	h.Store.RemoveFile(item.Path)

	// Remove from DB
	if err := h.DB.DeleteMedia(mediaID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete media")
		return
	}

	// If currently playing this video, stop playback
	h.Hub.ClearMediaPlaybackIfVideo(mediaID)

	// Broadcast media_removed
	msg, _ := ws.NewMessage("media_removed", map[string]string{"id": mediaID})
	h.Hub.BroadcastAll(msg)

	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}
