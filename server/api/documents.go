package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kalman/voicechat/db"
)

type DocumentsHandler struct {
	DB *db.DB
}

// HandleDocs dispatches document requests.
func (h *DocumentsHandler) HandleDocs(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// Extract channel ID: /api/v1/channels/{channelId}/docs...
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	channelID := parts[4]

	// Check channel access
	canAccess, _ := h.DB.CanAccessChannel(channelID, user.ID, user.IsAdmin)
	if !canAccess {
		writeError(w, http.StatusForbidden, "not a member of this channel")
		return
	}

	path := r.URL.Query().Get("path")

	switch r.Method {
	case http.MethodGet:
		if path != "" {
			// Get single document
			doc, err := h.DB.GetDocument(channelID, path)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if doc == nil {
				writeError(w, http.StatusNotFound, "document not found")
				return
			}
			writeJSON(w, http.StatusOK, doc)
		} else {
			// List documents
			prefix := r.URL.Query().Get("prefix")
			docs, err := h.DB.ListDocuments(channelID, prefix)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
			if docs == nil {
				docs = []db.DocumentMeta{}
			}
			writeJSON(w, http.StatusOK, docs)
		}

	case http.MethodPut:
		r.Body = http.MaxBytesReader(w, r.Body, 1024*1024) // 1MB for docs
		var req struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if req.Path == "" {
			writeError(w, http.StatusBadRequest, "path is required")
			return
		}
		if !strings.HasPrefix(req.Path, "/") {
			req.Path = "/" + req.Path
		}

		doc, err := h.DB.PutDocument(channelID, req.Path, req.Content, user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save document")
			return
		}
		writeJSON(w, http.StatusOK, doc)

	case http.MethodDelete:
		if path == "" {
			writeError(w, http.StatusBadRequest, "path query param required")
			return
		}
		if err := h.DB.DeleteDocument(channelID, path); err != nil {
			if strings.Contains(err.Error(), "not found") {
				writeError(w, http.StatusNotFound, "document not found")
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to delete document")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})

	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
