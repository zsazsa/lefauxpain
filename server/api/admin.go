package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/ws"
	"golang.org/x/crypto/bcrypt"
)

type AdminHandler struct {
	DB  *db.DB
	Hub *ws.Hub
}

type adminUserPayload struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatar_url"`
	IsAdmin   bool    `json:"is_admin"`
	CreatedAt string  `json:"created_at"`
}

func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	users, err := h.DB.GetAllUsers()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	payloads := make([]adminUserPayload, len(users))
	for i, u := range users {
		payloads[i] = adminUserPayload{
			ID:        u.ID,
			Username:  u.Username,
			AvatarURL: u.AvatarURL,
			IsAdmin:   u.IsAdmin,
			CreatedAt: u.CreatedAt,
		}
	}

	writeJSON(w, http.StatusOK, payloads)
}

func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Extract user ID from path: /api/v1/admin/users/{id}
	targetID := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/users/")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	if targetID == user.ID {
		writeError(w, http.StatusBadRequest, "cannot delete yourself")
		return
	}

	if err := h.DB.DeleteUser(targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Kick the user's WS connection
	h.Hub.DisconnectUser(targetID)

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *AdminHandler) SetAdmin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Extract user ID from path: /api/v1/admin/users/{id}/admin
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/users/")
	targetID := strings.TrimSuffix(path, "/admin")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	if targetID == user.ID {
		writeError(w, http.StatusBadRequest, "cannot change your own admin status")
		return
	}

	var body struct {
		IsAdmin bool `json:"is_admin"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.DB.SetAdmin(targetID, body.IsAdmin); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "is_admin": body.IsAdmin})
}

func (h *AdminHandler) SetPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Extract user ID from path: /api/v1/admin/users/{id}/password
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/users/")
	targetID := strings.TrimSuffix(path, "/password")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var passwordHash *string
	if body.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		s := string(hash)
		passwordHash = &s
	}

	if err := h.DB.SetPassword(targetID, passwordHash); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
