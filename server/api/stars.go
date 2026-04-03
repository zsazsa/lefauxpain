package api

import (
	"net/http"
	"strings"

	"github.com/kalman/voicechat/db"
)

type StarsHandler struct {
	DB *db.DB
}

func (h *StarsHandler) Star(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		writeError(w, http.StatusBadRequest, "missing message ID")
		return
	}
	messageID := parts[len(parts)-1]
	if err := h.DB.StarMessage(user.ID, messageID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to star message")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"status": "starred"})
}

func (h *StarsHandler) Unstar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 4 {
		writeError(w, http.StatusBadRequest, "missing message ID")
		return
	}
	messageID := parts[len(parts)-1]
	if err := h.DB.UnstarMessage(user.ID, messageID); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "star not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to unstar message")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unstarred"})
}

func (h *StarsHandler) List(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	msgs, err := h.DB.GetStarredMessages(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get starred messages")
		return
	}
	if msgs == nil {
		msgs = []db.StarredMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}
