package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/ws"
)

type WebhookHandler struct {
	DB  *db.DB
	Hub *ws.Hub
}

type incomingWebhookRequest struct {
	Channel string `json:"channel"`
	Content string `json:"content"`
}

// Incoming handles POST /api/v1/webhooks/incoming
func (h *WebhookHandler) Incoming(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Validate API key
	apiKey := r.Header.Get("X-Webhook-Key")
	if apiKey == "" {
		writeError(w, http.StatusUnauthorized, "missing X-Webhook-Key header")
		return
	}

	wk, err := h.DB.ValidateWebhookKey(apiKey)
	if err != nil {
		log.Printf("validate webhook key: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if wk == nil {
		writeError(w, http.StatusUnauthorized, "invalid API key")
		return
	}

	// Parse request body
	var req incomingWebhookRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if req.Content == "" {
		writeError(w, http.StatusBadRequest, "content is required")
		return
	}
	if len(req.Content) > 4000 {
		writeError(w, http.StatusBadRequest, "content exceeds 4000 character limit")
		return
	}
	if req.Channel == "" {
		writeError(w, http.StatusBadRequest, "channel is required")
		return
	}

	// Look up channel by name (strip # prefix if present)
	channelName := strings.TrimPrefix(req.Channel, "#")
	ch, err := h.DB.GetChannelByName(channelName)
	if err != nil {
		log.Printf("get channel by name: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if ch == nil {
		writeError(w, http.StatusNotFound, "channel not found: "+channelName)
		return
	}
	if ch.Type != "text" {
		writeError(w, http.StatusBadRequest, "channel is not a text channel")
		return
	}

	// Get bot user
	botUser, err := h.DB.GetBotUser()
	if err != nil || botUser == nil {
		log.Printf("get bot user: %v", err)
		writeError(w, http.StatusInternalServerError, "bot user not found")
		return
	}

	// Create message
	msgID := uuid.New().String()
	content := req.Content
	msg, err := h.DB.CreateMessage(msgID, ch.ID, botUser.ID, &content, nil)
	if err != nil {
		log.Printf("create webhook message: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to create message")
		return
	}

	// Broadcast to all connected WebSocket clients
	broadcast, _ := ws.NewMessage("message_create", ws.MessageCreatePayload{
		ID:        msg.ID,
		ChannelID: msg.ChannelID,
		Author: ws.UserPayload{
			ID:       botUser.ID,
			Username: botUser.Username,
		},
		Content:     msg.Content,
		Attachments: []ws.AttachmentPayload{},
		Mentions:    []string{},
		CreatedAt:   msg.CreatedAt,
	})
	h.Hub.BroadcastAll(broadcast)

	writeJSON(w, http.StatusCreated, map[string]string{
		"id":         msg.ID,
		"channel_id": ch.ID,
		"created_at": msg.CreatedAt,
	})
}

// AdminListKeys handles GET /api/v1/admin/webhook-keys
func (h *WebhookHandler) AdminListKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	keys, err := h.DB.ListWebhookKeys()
	if err != nil {
		log.Printf("list webhook keys: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	if keys == nil {
		keys = []db.WebhookKey{}
	}
	writeJSON(w, http.StatusOK, keys)
}

// AdminCreateKey handles POST /api/v1/admin/webhook-keys
func (h *WebhookHandler) AdminCreateKey(w http.ResponseWriter, r *http.Request) {
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
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}

	key, err := h.DB.CreateWebhookKey(req.Name)
	if err != nil {
		log.Printf("create webhook key: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, key)
}

// AdminDeleteKey handles DELETE /api/v1/admin/webhook-keys/{id}
func (h *WebhookHandler) AdminDeleteKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := UserFromContext(r.Context())
	if user == nil || !user.IsAdmin {
		writeError(w, http.StatusForbidden, "admin access required")
		return
	}

	// Extract ID from path: /api/v1/admin/webhook-keys/{id}
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 6 {
		writeError(w, http.StatusBadRequest, "missing key ID")
		return
	}
	keyID := parts[len(parts)-1]

	if err := h.DB.DeleteWebhookKey(keyID); err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "webhook key not found")
			return
		}
		log.Printf("delete webhook key: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
