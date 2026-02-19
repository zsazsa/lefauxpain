package api

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/storage"
	"github.com/kalman/voicechat/ws"
)

type RadioHandler struct {
	DB    *db.DB
	Store *storage.FileStore
	Hub   *ws.Hub
}

type radioTrackResponse struct {
	ID        string  `json:"id"`
	Filename  string  `json:"filename"`
	URL       string  `json:"url"`
	MimeType  string  `json:"mime_type"`
	SizeBytes int64   `json:"size_bytes"`
	Duration  float64 `json:"duration"`
	Position  int     `json:"position"`
	Waveform  *string `json:"waveform,omitempty"`
}

// UploadTrack handles POST /api/v1/radio/playlists/{playlist_id}/tracks
func (h *RadioHandler) UploadTrack(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())

	// Extract playlist_id from path: /api/v1/radio/playlists/{playlist_id}/tracks
	parts := strings.Split(r.URL.Path, "/")
	// Expected: ["", "api", "v1", "radio", "playlists", "{id}", "tracks"]
	if len(parts) < 7 {
		writeError(w, http.StatusBadRequest, "missing playlist id")
		return
	}
	playlistID := parts[5]

	// Verify playlist exists and belongs to user
	playlist, err := h.DB.GetPlaylistByID(playlistID)
	if err != nil {
		writeError(w, http.StatusNotFound, "playlist not found")
		return
	}
	if playlist.UserID != user.ID {
		writeError(w, http.StatusForbidden, "not your playlist")
		return
	}

	// Parse upload (500MB max)
	const maxSize int64 = 500 * 1024 * 1024
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "file too large (max 500MB)")
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
	if !h.Store.IsAudioMIME(mimeType) {
		writeError(w, http.StatusBadRequest, "unsupported file type (audio only)")
		return
	}

	relPath, err := h.Store.StoreAudio(file, mimeType)
	if err != nil {
		log.Printf("radio track upload store error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}

	var duration float64
	if d := r.FormValue("duration"); d != "" {
		duration, _ = strconv.ParseFloat(d, 64)
	}
	// Server-side fallback: parse duration from file if client didn't provide it
	if duration <= 0 {
		duration = h.Store.GetAudioDuration(relPath, mimeType)
	}

	var waveform *string
	if wf := r.FormValue("waveform"); wf != "" {
		waveform = &wf
	}

	trackID := uuid.New().String()
	track := &db.RadioTrack{
		ID:         trackID,
		PlaylistID: playlistID,
		Filename:   header.Filename,
		Path:       relPath,
		MimeType:   mimeType,
		SizeBytes:  header.Size,
		Duration:   duration,
		Waveform:   waveform,
	}

	if err := h.DB.CreateRadioTrack(track); err != nil {
		log.Printf("radio track upload db error: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to save track")
		return
	}

	url := "/" + strings.ReplaceAll(relPath, "\\", "/")
	writeJSON(w, http.StatusOK, radioTrackResponse{
		ID:        trackID,
		Filename:  header.Filename,
		URL:       url,
		MimeType:  mimeType,
		SizeBytes: header.Size,
		Duration:  track.Duration,
		Position:  track.Position,
		Waveform:  waveform,
	})
}

// DeleteTrack handles DELETE /api/v1/radio/tracks/{track_id}
func (h *RadioHandler) DeleteTrack(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())

	// Extract track_id from path
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 6 {
		writeError(w, http.StatusBadRequest, "missing track id")
		return
	}
	trackID := parts[len(parts)-1]

	track, err := h.DB.GetTrackByID(trackID)
	if err != nil {
		writeError(w, http.StatusNotFound, "track not found")
		return
	}

	// Verify ownership via playlist
	playlist, err := h.DB.GetPlaylistByID(track.PlaylistID)
	if err != nil || playlist.UserID != user.ID {
		writeError(w, http.StatusForbidden, "not your track")
		return
	}

	h.Store.RemoveFile(track.Path)

	if err := h.DB.DeleteRadioTrack(trackID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete track")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}
