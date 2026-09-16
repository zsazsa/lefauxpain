package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kalman/voicechat/db"
)

// APIKeysHandler lets a user mint and revoke personal API keys. The keys
// authenticate the MCP endpoint (and nothing else) as that user.
type APIKeysHandler struct {
	DB *db.DB
}

// Handle serves GET (list) and POST (create) on /api/v1/api-keys.
func (h *APIKeysHandler) Handle(w http.ResponseWriter, r *http.Request) {
	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	switch r.Method {
	case http.MethodGet:
		keys, err := h.DB.ListAPIKeys(user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		writeJSON(w, http.StatusOK, keys)

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		name := strings.TrimSpace(body.Name)
		if name == "" || len(name) > 64 {
			writeError(w, http.StatusBadRequest, "name must be 1-64 characters")
			return
		}
		created, err := h.DB.CreateAPIKey(user.ID, name)
		if err != nil {
			if strings.Contains(err.Error(), "limit reached") {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeError(w, http.StatusInternalServerError, "failed to create key")
			return
		}
		writeJSON(w, http.StatusCreated, created)

	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Delete serves DELETE /api/v1/api-keys/{id}.
func (h *APIKeysHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/api-keys/")
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusBadRequest, "missing key id")
		return
	}
	if err := h.DB.DeleteAPIKey(user.ID, id); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "key not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to delete key")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
