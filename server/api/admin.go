package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/kalman/voicechat/crypto"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/email"
	"github.com/kalman/voicechat/ws"
	"golang.org/x/crypto/bcrypt"
)

type AdminHandler struct {
	DB           *db.DB
	Hub          *ws.Hub
	EmailService *email.EmailService
	EncKey       []byte
}

type adminUserPayload struct {
	ID            string  `json:"id"`
	Username      string  `json:"username"`
	AvatarURL     *string `json:"avatar_url"`
	IsAdmin       bool    `json:"is_admin"`
	Approved      bool    `json:"approved"`
	KnockMessage  *string `json:"knock_message,omitempty"`
	Email         *string `json:"email,omitempty"`
	EmailVerified bool    `json:"email_verified"`
	CreatedAt     string  `json:"created_at"`
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
			ID:            u.ID,
			Username:      u.Username,
			AvatarURL:     u.AvatarURL,
			IsAdmin:       u.IsAdmin,
			Approved:      u.Approved,
			KnockMessage:  u.KnockMessage,
			Email:         u.Email,
			EmailVerified: u.EmailVerifiedAt != nil,
			CreatedAt:     u.CreatedAt,
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

func (h *AdminHandler) ApproveUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Extract user ID from path: /api/v1/admin/users/{id}/approve
	path := strings.TrimPrefix(r.URL.Path, "/api/v1/admin/users/")
	targetID := strings.TrimSuffix(path, "/approve")
	if targetID == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}

	if err := h.DB.ApproveUser(targetID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// Broadcast user_approved so all clients add the new member
	approvedUser, _ := h.DB.GetUserByID(targetID)
	if approvedUser != nil {
		msg, _ := ws.NewMessage("user_approved", ws.UserOnlineData{
			User: ws.UserPayload{
				ID:       approvedUser.ID,
				Username: approvedUser.Username,
				IsAdmin:  approvedUser.IsAdmin,
			},
		})
		h.Hub.BroadcastAll(msg)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "approved"})
}

func (h *AdminHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	enabled, _ := h.DB.GetSetting("email_verification_enabled")

	result := map[string]any{
		"email_verification_enabled": enabled == "true",
	}

	// Decrypt provider config if it exists
	encrypted, _ := h.DB.GetSetting("email_provider_config")
	if encrypted != "" {
		decrypted, err := crypto.Decrypt(h.EncKey, encrypted)
		if err == nil {
			var cfg email.ProviderConfig
			if json.Unmarshal([]byte(decrypted), &cfg) == nil {
				result["email_provider_config"] = cfg
			}
		}
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *AdminHandler) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	var req struct {
		EmailVerificationEnabled *bool                 `json:"email_verification_enabled"`
		EmailProviderConfig      *email.ProviderConfig `json:"email_provider_config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Save provider config if provided
	if req.EmailProviderConfig != nil {
		cfgJSON, _ := json.Marshal(req.EmailProviderConfig)
		encrypted, err := crypto.Encrypt(h.EncKey, string(cfgJSON))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if err := h.DB.SetSetting("email_provider_config", encrypted); err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}

	// Toggle verification
	if req.EmailVerificationEnabled != nil {
		if *req.EmailVerificationEnabled {
			// Validate that provider config exists (either in this request or already in DB)
			if req.EmailProviderConfig == nil {
				existing, _ := h.DB.GetSetting("email_provider_config")
				if existing == "" {
					writeError(w, http.StatusBadRequest, "email provider must be configured before enabling verification")
					return
				}
			}
			if err := h.DB.SetSetting("email_verification_enabled", "true"); err != nil {
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}
		} else {
			// Check if was previously enabled
			wasEnabled, _ := h.DB.GetSetting("email_verification_enabled")

			if err := h.DB.SetSetting("email_verification_enabled", "false"); err != nil {
				writeError(w, http.StatusInternalServerError, "internal error")
				return
			}

			// Auto-advance mid-verification users
			if wasEnabled == "true" {
				advanced, err := h.DB.AdvancePendingVerificationUsers()
				if err != nil {
					log.Printf("advance pending verification users: %v", err)
				}
				if advanced > 0 {
					log.Printf("auto-advanced %d mid-verification users", advanced)
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
