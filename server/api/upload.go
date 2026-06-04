package api

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/storage"
)

type UploadHandler struct {
	DB             *db.DB
	Store          *storage.FileStore
	MaxSize        int64
	MaxArchiveSize int64
}

// blockedArchiveExts are zip-container document and package formats. They sniff
// as application/zip but are disallowed as generic archive uploads. Detection is
// by filename extension only (the archive bytes are never read), so renaming to
// .zip bypasses this — an accepted limitation, not a security boundary.
var blockedArchiveExts = map[string]bool{
	".docx": true, ".docm": true, ".dotx": true, ".dotm": true,
	".xlsx": true, ".xlsm": true, ".xltx": true, ".xltm": true,
	".pptx": true, ".pptm": true, ".potx": true, ".ppsx": true,
	".odt": true, ".ods": true, ".odp": true, ".odg": true,
	".jar": true, ".war": true, ".ear": true,
	".apk": true, ".aab": true, ".ipa": true,
	".epub": true,
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

	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Bound the body by the larger (archive) limit so zips can be read; the
	// per-type limit is enforced below once the real MIME type is known. The
	// ParseMultipartForm maxMemory stays at the image limit so large archives
	// spill to temp files instead of buffering entirely in memory.
	maxBody := h.MaxArchiveSize
	if maxBody < h.MaxSize {
		maxBody = h.MaxSize
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
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

	mimeType, err2 := storage.DetectMIME(file)
	if err2 != nil {
		writeError(w, http.StatusBadRequest, "cannot read file")
		return
	}

	attID := uuid.New().String()
	att := &db.Attachment{
		ID:         attID,
		Filename:   header.Filename,
		SizeBytes:  header.Size,
		MimeType:   mimeType,
		UploadedBy: &user.ID,
	}

	switch {
	case h.Store.IsAllowedMIME(mimeType):
		if header.Size > h.MaxSize {
			writeError(w, http.StatusBadRequest, "file too large")
			return
		}
		stored, err := h.Store.Store(file, mimeType)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to store file")
			return
		}
		att.Path = stored.Path
		if stored.Width > 0 {
			w2 := stored.Width
			h2 := stored.Height
			att.Width = &w2
			att.Height = &h2
		}
		if stored.ThumbPath != "" {
			att.ThumbPath = &stored.ThumbPath
		}
	case h.Store.IsArchiveMIME(mimeType):
		if blockedArchiveExts[strings.ToLower(filepath.Ext(header.Filename))] {
			writeError(w, http.StatusBadRequest, "unsupported file type")
			return
		}
		if header.Size > h.MaxArchiveSize {
			writeError(w, http.StatusBadRequest, "file too large")
			return
		}
		relPath, err := h.Store.StoreArchive(file, mimeType)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to store file")
			return
		}
		att.Path = relPath
	default:
		writeError(w, http.StatusBadRequest, "unsupported file type")
		return
	}

	if err := h.DB.CreateAttachment(att); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save attachment")
		return
	}

	resp := uploadResponse{
		ID:       attID,
		URL:      "/" + strings.ReplaceAll(att.Path, "\\", "/"),
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
