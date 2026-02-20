package api

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/email"
	"github.com/kalman/voicechat/ws"
	"golang.org/x/crypto/bcrypt"
)

var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_]{1,32}$`)

var emailRegex = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

type AuthHandler struct {
	DB           *db.DB
	Hub          *ws.Hub
	EmailService *email.EmailService
}

type authRequest struct {
	Username     string  `json:"username"`
	Password     *string `json:"password"`
	Email        *string `json:"email"`
	KnockMessage *string `json:"knock_message"`
}

type authResponse struct {
	User  *userPayload `json:"user"`
	Token string       `json:"token"`
}

type userPayload struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	AvatarURL   *string `json:"avatar_url"`
	Email       *string `json:"email,omitempty"`
	IsAdmin     bool    `json:"is_admin"`
	HasPassword bool    `json:"has_password"`
}

func newUserPayload(u *db.User) *userPayload {
	return &userPayload{
		ID:          u.ID,
		Username:    u.Username,
		AvatarURL:   u.AvatarURL,
		Email:       u.Email,
		IsAdmin:     u.IsAdmin,
		HasPassword: u.PasswordHash != nil,
	}
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	verificationEnabled, err := h.EmailService.IsVerificationEnabled()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	if verificationEnabled {
		// All three fields required when verification is enabled
		if req.Username == "" {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
		if req.Email == nil || strings.TrimSpace(*req.Email) == "" {
			writeError(w, http.StatusBadRequest, "email is required")
			return
		}
		if req.Password == nil || *req.Password == "" {
			writeError(w, http.StatusBadRequest, "password is required")
			return
		}
		if !emailRegex.MatchString(*req.Email) {
			writeError(w, http.StatusBadRequest, "invalid email format")
			return
		}
	}

	if !usernameRegex.MatchString(req.Username) {
		writeError(w, http.StatusBadRequest, "username must be 1-32 alphanumeric characters or underscores")
		return
	}

	// Check if username already taken (case-insensitive)
	existing, err := h.DB.GetUserByUsername(req.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "username already taken")
		return
	}

	// Check email uniqueness if provided
	var emailPtr *string
	if req.Email != nil && strings.TrimSpace(*req.Email) != "" {
		trimmed := strings.TrimSpace(*req.Email)
		emailPtr = &trimmed
		existingEmail, err := h.DB.GetUserByEmail(trimmed)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		if existingEmail != nil {
			writeError(w, http.StatusConflict, "email already in use")
			return
		}
	}

	// Hash password if provided
	var passwordHash *string
	if req.Password != nil && *req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		s := string(hash)
		passwordHash = &s
	}

	// First user is admin and auto-approved; others need approval
	userCount, err := h.DB.UserCount()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	isFirstUser := userCount == 0
	isAdmin := isFirstUser
	approved := isFirstUser

	// Capture registration IP
	clientIP := r.Header.Get("X-Real-IP")
	if clientIP == "" {
		clientIP = r.RemoteAddr
		if host, _, err := net.SplitHostPort(clientIP); err == nil {
			clientIP = host
		}
	}
	registerIP := &clientIP

	userID := uuid.New().String()
	if err := h.DB.CreateUser(userID, req.Username, passwordHash, emailPtr, isAdmin, approved, req.KnockMessage, registerIP); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	// If email verification is enabled and user is not first user, send verification code
	if verificationEnabled && !isFirstUser && emailPtr != nil {
		if err := h.EmailService.GenerateAndSendCode(userID, *emailPtr); err != nil {
			log.Printf("generate verification code: %v", err)
		}
		writeJSON(w, http.StatusAccepted, map[string]bool{"pending_verification": true})
		return
	}

	if !approved {
		// Notify all online admins about the pending user
		h.notifyAdminsPendingUser(userID, req.Username)
		writeJSON(w, http.StatusAccepted, map[string]bool{"pending": true})
		return
	}

	token := uuid.New().String()
	if err := h.DB.CreateToken(token, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	user, _ := h.DB.GetUserByID(userID)
	writeJSON(w, http.StatusCreated, authResponse{
		User:  newUserPayload(user),
		Token: token,
	})
}

func (h *AuthHandler) notifyAdminsPendingUser(userID, username string) {
	admins, err := h.DB.GetAdminUsers()
	if err != nil {
		log.Printf("get admin users for notification: %v", err)
		return
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	notifData := map[string]string{
		"subject_user_id": userID,
		"username":        username,
	}
	dataJSON, _ := json.Marshal(notifData)
	for _, admin := range admins {
		notifID := uuid.New().String()
		if err := h.DB.CreateNotification(notifID, admin.ID, "pending_user", notifData); err != nil {
			log.Printf("create admin notification: %v", err)
			continue
		}
		notifMsg, _ := ws.NewMessage("notification_create", ws.NotificationPayload{
			ID:        notifID,
			Type:      "pending_user",
			Data:      dataJSON,
			Read:      false,
			CreatedAt: now,
		})
		h.Hub.SendTo(admin.ID, notifMsg)
	}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Try username first, then email
	user, err := h.DB.GetUserByUsername(req.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		user, err = h.DB.GetUserByEmail(req.Username)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Check password if user has one set
	if user.PasswordHash != nil {
		password := ""
		if req.Password != nil {
			password = *req.Password
		}
		if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)); err != nil {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
	}

	// Check email verification status — only block unapproved users mid-verification
	verificationEnabled, _ := h.EmailService.IsVerificationEnabled()
	if verificationEnabled && !user.Approved && user.Email != nil && user.EmailVerifiedAt == nil {
		// Send a verification code so the user can proceed
		_ = h.EmailService.GenerateAndSendCode(user.ID, *user.Email)
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "please verify your email", "pending_verification": true})
		return
	}

	if !user.Approved {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "account pending approval", "pending": true})
		return
	}

	token := uuid.New().String()
	if err := h.DB.CreateToken(token, user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, authResponse{
		User:  newUserPayload(user),
		Token: token,
	})
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// If user has an existing password, verify current_password
	if user.PasswordHash != nil {
		if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(req.CurrentPassword)); err != nil {
			writeError(w, http.StatusUnauthorized, "current password is incorrect")
			return
		}
	}

	// Set or remove password
	var passwordHash *string
	if req.NewPassword != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		s := string(hash)
		passwordHash = &s
	}

	if err := h.DB.SetPassword(user.ID, passwordHash); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "has_password": passwordHash != nil})
}

func (h *AuthHandler) UpdateEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	trimmed := strings.TrimSpace(req.Email)

	// Empty string = remove email
	if trimmed == "" {
		if err := h.DB.SetEmail(user.ID, nil); err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "email": nil})
		return
	}

	// Validate format
	if !emailRegex.MatchString(trimmed) {
		writeError(w, http.StatusBadRequest, "invalid email format")
		return
	}

	// Check uniqueness (case-insensitive)
	existing, err := h.DB.GetUserByEmail(trimmed)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if existing != nil && existing.ID != user.ID {
		writeError(w, http.StatusConflict, "email already in use")
		return
	}

	if err := h.DB.SetEmail(user.ID, &trimmed); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "updated", "email": trimmed})
}

func (h *AuthHandler) Verify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := h.DB.GetUserByEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		writeError(w, http.StatusNotFound, "no account found with that email")
		return
	}

	// Already verified
	if user.EmailVerifiedAt != nil {
		writeError(w, http.StatusBadRequest, "email already verified")
		return
	}

	vc, err := h.DB.GetVerificationCode(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if vc == nil {
		writeError(w, http.StatusBadRequest, "no pending verification code, please request a new one")
		return
	}

	// Check expiry
	if vc.Expired {
		writeError(w, http.StatusBadRequest, "code expired, please request a new one")
		return
	}

	// Check attempts
	if vc.Attempts >= 5 {
		h.DB.InvalidateVerificationCode(vc.ID)
		writeError(w, http.StatusBadRequest, "too many failed attempts, please request a new code")
		return
	}

	// Compare code
	if err := bcrypt.CompareHashAndPassword([]byte(vc.CodeHash), []byte(req.Code)); err != nil {
		h.DB.IncrementVerificationAttempts(vc.ID)
		newAttempts := vc.Attempts + 1
		if newAttempts >= 5 {
			h.DB.InvalidateVerificationCode(vc.ID)
			writeError(w, http.StatusBadRequest, "too many failed attempts, please request a new code")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid code")
		return
	}

	// Success: mark verified, delete code, notify admins
	if err := h.DB.SetEmailVerified(user.ID); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	h.DB.InvalidateVerificationCode(vc.ID)

	// Notify admins about pending user
	h.notifyAdminsPendingUser(user.ID, user.Username)

	writeJSON(w, http.StatusOK, map[string]any{"status": "verified", "pending_approval": true})
}

func (h *AuthHandler) ResendCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, err := h.DB.GetUserByEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		writeError(w, http.StatusNotFound, "no account found with that email")
		return
	}

	// Must be in pending_verification state
	if user.EmailVerifiedAt != nil {
		writeError(w, http.StatusBadRequest, "email already verified")
		return
	}

	// Rate limit: max 3 codes per hour
	count, err := h.DB.CountRecentVerificationCodes(user.ID, time.Now().Add(-1*time.Hour))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if count >= 3 {
		writeError(w, http.StatusTooManyRequests, "too many resend requests, please try again later")
		return
	}

	if err := h.EmailService.GenerateAndSendCode(user.ID, *user.Email); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Check email provider is configured
	cfg, err := h.EmailService.GetProviderConfig()
	if err != nil || cfg == nil {
		writeError(w, http.StatusBadRequest, "email is not configured on this server")
		return
	}

	// Always return 200 to not leak user existence
	user, err := h.DB.GetUserByEmail(req.Email)
	if err != nil || user == nil || user.Email == nil {
		writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
		return
	}

	// Rate limit: max 3 codes per hour
	count, err := h.DB.CountRecentVerificationCodes(user.ID, time.Now().Add(-1*time.Hour))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if count >= 3 {
		// Still return 200 to not leak info
		writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
		return
	}

	if err := h.EmailService.GenerateAndSendResetCode(user.ID, *user.Email); err != nil {
		log.Printf("generate reset code: %v", err)
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "sent"})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.NewPassword == "" {
		writeError(w, http.StatusBadRequest, "new password is required")
		return
	}

	user, err := h.DB.GetUserByEmail(req.Email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if user == nil {
		writeError(w, http.StatusBadRequest, "invalid email or code")
		return
	}

	vc, err := h.DB.GetVerificationCode(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if vc == nil {
		writeError(w, http.StatusBadRequest, "no pending reset code, please request a new one")
		return
	}

	if vc.Expired {
		writeError(w, http.StatusBadRequest, "code expired, please request a new one")
		return
	}

	if vc.Attempts >= 5 {
		h.DB.InvalidateVerificationCode(vc.ID)
		writeError(w, http.StatusBadRequest, "too many failed attempts, please request a new code")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(vc.CodeHash), []byte(req.Code)); err != nil {
		h.DB.IncrementVerificationAttempts(vc.ID)
		newAttempts := vc.Attempts + 1
		if newAttempts >= 5 {
			h.DB.InvalidateVerificationCode(vc.ID)
			writeError(w, http.StatusBadRequest, "too many failed attempts, please request a new code")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid code")
		return
	}

	// Success: hash new password, update, invalidate code
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	s := string(hash)
	if err := h.DB.SetPassword(user.ID, &s); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	h.DB.InvalidateVerificationCode(vc.ID)

	writeJSON(w, http.StatusOK, map[string]string{"status": "reset"})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
