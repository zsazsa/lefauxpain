package api

import (
	"encoding/json"
	"net/http"
	"regexp"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"golang.org/x/crypto/bcrypt"
)

var usernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_]{1,32}$`)

type AuthHandler struct {
	DB *db.DB
}

type authRequest struct {
	Username string  `json:"username"`
	Password *string `json:"password"`
}

type authResponse struct {
	User  *userPayload `json:"user"`
	Token string       `json:"token"`
}

type userPayload struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatar_url"`
}

func newUserPayload(u *db.User) *userPayload {
	return &userPayload{
		ID:        u.ID,
		Username:  u.Username,
		AvatarURL: u.AvatarURL,
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

	if !usernameRegex.MatchString(req.Username) {
		writeError(w, http.StatusBadRequest, "username must be 1-32 alphanumeric characters or underscores")
		return
	}

	// Check if username already taken
	existing, err := h.DB.GetUserByUsername(req.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "username already taken")
		return
	}

	// Hash password if provided
	var passwordHash *string
	if req.Password != nil && *req.Password != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), bcrypt.DefaultCost)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		h := string(hash)
		passwordHash = &h
	}

	// First user is admin
	userCount, err := h.DB.UserCount()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	isAdmin := userCount == 0

	userID := uuid.New().String()
	if err := h.DB.CreateUser(userID, req.Username, passwordHash, isAdmin); err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
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

	user, err := h.DB.GetUserByUsername(req.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
