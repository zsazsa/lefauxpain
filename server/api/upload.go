package api

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/storage"
)

type UploadHandler struct {
	DB        *db.DB
	Store     *storage.FileStore
	MaxSize   int64
}

type uploadResponse struct {
	ID       string  `json:"id"`
	URL      string  `json:"url"`
	ThumbURL *string `json:"thumb_url"`
	Filename string  `json:"filename"`
	MimeType string  `json:"mime_type"`
	Width    *int    `json:"width"`
	Height   *int    `json:"height"`
}

func (h *UploadHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

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

	mimeType := storage.DetectMIME(header)
	if !h.Store.IsAllowedMIME(mimeType) {
		writeError(w, http.StatusBadRequest, "unsupported file type")
		return
	}

	stored, err := h.Store.Store(file, mimeType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to store file")
		return
	}

	attID := uuid.New().String()
	att := &db.Attachment{
		ID:        attID,
		Filename:  header.Filename,
		Path:      stored.Path,
		SizeBytes: header.Size,
		MimeType:  mimeType,
	}
	if stored.Width > 0 {
		w2 := stored.Width
		h2 := stored.Height
		att.Width = &w2
		att.Height = &h2
	}
	if stored.ThumbPath != "" {
		att.ThumbPath = &stored.ThumbPath
	}

	if err := h.DB.CreateAttachment(att); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save attachment")
		return
	}

	resp := uploadResponse{
		ID:       attID,
		URL:      "/" + strings.ReplaceAll(stored.Path, "\\", "/"),
		Filename: header.Filename,
		MimeType: mimeType,
		Width:    att.Width,
		Height:   att.Height,
	}
	if att.ThumbPath != nil {
		t := "/" + strings.ReplaceAll(*att.ThumbPath, "\\", "/")
		resp.ThumbURL = &t
	}

	writeJSON(w, http.StatusOK, resp)
}
