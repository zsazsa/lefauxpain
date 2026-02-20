package ws

import (
	"encoding/json"
	"log"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/pion/webrtc/v4"
)

// Client → Server data types

type SendMessageData struct {
	ChannelID     string   `json:"channel_id"`
	Content       *string  `json:"content"`
	ReplyToID     *string  `json:"reply_to_id"`
	AttachmentIDs []string `json:"attachment_ids"`
}

type EditMessageData struct {
	MessageID string `json:"message_id"`
	Content   string `json:"content"`
}

type DeleteMessageData struct {
	MessageID string `json:"message_id"`
}

type ReactionData struct {
	MessageID string `json:"message_id"`
	Emoji     string `json:"emoji"`
}

type TypingData struct {
	ChannelID string `json:"channel_id"`
}

type CreateChannelData struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type DeleteChannelData struct {
	ChannelID string `json:"channel_id"`
}

type ReorderChannelsData struct {
	ChannelIDs []string `json:"channel_ids"`
}

// Server → Client broadcast types

type MessageCreatePayload struct {
	ID          string                  `json:"id"`
	ChannelID   string                  `json:"channel_id"`
	Author      UserPayload             `json:"author"`
	Content     *string                 `json:"content"`
	ReplyTo     *ReplyToPayload         `json:"reply_to"`
	Attachments []AttachmentPayload     `json:"attachments"`
	Mentions    []string                `json:"mentions"`
	CreatedAt   string                  `json:"created_at"`
}

type ReplyToPayload struct {
	ID      string      `json:"id"`
	Author  UserPayload `json:"author"`
	Content *string     `json:"content"`
	Deleted bool        `json:"deleted"`
}

type AttachmentPayload struct {
	ID       string  `json:"id"`
	Filename string  `json:"filename"`
	URL      string  `json:"url"`
	ThumbURL *string `json:"thumb_url"`
	MimeType string  `json:"mime_type"`
	Width    *int    `json:"width"`
	Height   *int    `json:"height"`
}

type MessageUpdatePayload struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
	Content   string `json:"content"`
	EditedAt  string `json:"edited_at"`
}

type MessageDeletePayload struct {
	ID        string `json:"id"`
	ChannelID string `json:"channel_id"`
}

type ReactionAddPayload struct {
	MessageID string `json:"message_id"`
	UserID    string `json:"user_id"`
	Emoji     string `json:"emoji"`
}

type ReactionRemovePayload struct {
	MessageID string `json:"message_id"`
	UserID    string `json:"user_id"`
	Emoji     string `json:"emoji"`
}

type TypingStartPayload struct {
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id"`
}

type ChannelDeletePayload struct {
	ChannelID string `json:"channel_id"`
}

type ChannelReorderPayload struct {
	ChannelIDs []string `json:"channel_ids"`
}

type RenameChannelData struct {
	ChannelID string `json:"channel_id"`
	Name      string `json:"name"`
}

type RestoreChannelData struct {
	ChannelID string `json:"channel_id"`
}

type ChannelManagerData struct {
	ChannelID string `json:"channel_id"`
	UserID    string `json:"user_id"`
}

type ChannelUpdatePayload struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	ManagerIDs []string `json:"manager_ids"`
}

var mentionRegex = regexp.MustCompile(`<@([a-f0-9-]{36})>`)

func (h *Hub) handleSendMessage(c *Client, data json.RawMessage) {
	var d SendMessageData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if d.Content == nil && len(d.AttachmentIDs) == 0 {
		return
	}
	if d.Content != nil && len(*d.Content) > 4000 {
		return
	}

	// Verify channel exists
	ch, err := h.DB.GetChannelByID(d.ChannelID)
	if err != nil || ch == nil || ch.Type != "text" {
		return
	}

	msgID := uuid.New().String()
	msg, err := h.DB.CreateMessage(msgID, d.ChannelID, c.UserID, d.Content, d.ReplyToID)
	if err != nil {
		log.Printf("create message: %v", err)
		return
	}

	// Link attachments
	if len(d.AttachmentIDs) > 0 {
		if err := h.DB.LinkAttachmentsToMessage(msgID, d.AttachmentIDs); err != nil {
			log.Printf("link attachments: %v", err)
		}
	}

	// Parse mentions
	var mentionIDs []string
	if d.Content != nil {
		matches := mentionRegex.FindAllStringSubmatch(*d.Content, -1)
		for _, m := range matches {
			mentionIDs = append(mentionIDs, m[1])
		}
		if len(mentionIDs) > 0 {
			h.DB.CreateMentions(msgID, mentionIDs)

			// Create notifications for mentioned users (exclude self)
			for _, mentionedID := range mentionIDs {
				if mentionedID == c.UserID {
					continue
				}
				notifID := uuid.New().String()
				// Get channel name for the payload
				chName := ""
				if ch != nil {
					chName = ch.Name
				}
				// Build content preview
				var preview string
				if d.Content != nil {
					preview = *d.Content
					if len(preview) > 80 {
						preview = preview[:80] + "..."
					}
				}
				notifData := map[string]any{
					"message_id":      msgID,
					"channel_id":      d.ChannelID,
					"channel_name":    chName,
					"author_id":       c.User.ID,
					"author_username": c.User.Username,
					"content_preview": preview,
				}
				if err := h.DB.CreateNotification(notifID, mentionedID, "mention", notifData); err != nil {
					log.Printf("create notification: %v", err)
					continue
				}
				dataJSON, _ := json.Marshal(notifData)
				notifMsg, _ := NewMessage("notification_create", NotificationPayload{
					ID:        notifID,
					Type:      "mention",
					Data:      dataJSON,
					Read:      false,
					CreatedAt: msg.CreatedAt,
				})
				h.SendTo(mentionedID, notifMsg)
			}
		}
	}
	if mentionIDs == nil {
		mentionIDs = []string{}
	}

	// Get attachments
	attachments, _ := h.DB.GetAttachmentsByMessage(msgID)
	attachPayloads := make([]AttachmentPayload, len(attachments))
	for i, a := range attachments {
		ap := AttachmentPayload{
			ID:       a.ID,
			Filename: a.Filename,
			URL:      "/" + strings.ReplaceAll(a.Path, "\\", "/"),
			MimeType: a.MimeType,
			Width:    a.Width,
			Height:   a.Height,
		}
		if a.ThumbPath != nil {
			t := "/" + strings.ReplaceAll(*a.ThumbPath, "\\", "/")
			ap.ThumbURL = &t
		}
		attachPayloads[i] = ap
	}

	// Build reply context
	var replyTo *ReplyToPayload
	if msg.ReplyToID != nil {
		rc, _ := h.DB.GetReplyContext(*msg.ReplyToID)
		if rc != nil {
			rcAuthorID := ""
			if rc.AuthorID != nil {
				rcAuthorID = *rc.AuthorID
			}
			replyTo = &ReplyToPayload{
				ID: rc.ID,
				Author: UserPayload{
					ID:       rcAuthorID,
					Username: rc.AuthorUsername,
				},
				Content: rc.Content,
				Deleted: rc.DeletedAt != nil,
			}
		}
	}

	broadcast, _ := NewMessage("message_create", MessageCreatePayload{
		ID:        msg.ID,
		ChannelID: msg.ChannelID,
		Author: UserPayload{
			ID:       c.User.ID,
			Username: c.User.Username,
		},
		Content:     msg.Content,
		ReplyTo:     replyTo,
		Attachments: attachPayloads,
		Mentions:    mentionIDs,
		CreatedAt:   msg.CreatedAt,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleEditMessage(c *Client, data json.RawMessage) {
	var d EditMessageData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if len(d.Content) == 0 || len(d.Content) > 4000 {
		return
	}

	msg, err := h.DB.GetMessageByID(d.MessageID)
	if err != nil || msg == nil || msg.DeletedAt != nil {
		return
	}
	if msg.AuthorID == nil || *msg.AuthorID != c.UserID {
		return
	}

	if err := h.DB.EditMessage(d.MessageID, d.Content); err != nil {
		log.Printf("edit message: %v", err)
		return
	}

	updated, _ := h.DB.GetMessageByID(d.MessageID)
	if updated == nil {
		return
	}

	broadcast, _ := NewMessage("message_update", MessageUpdatePayload{
		ID:        updated.ID,
		ChannelID: updated.ChannelID,
		Content:   d.Content,
		EditedAt:  *updated.EditedAt,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleDeleteMessage(c *Client, data json.RawMessage) {
	var d DeleteMessageData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	msg, err := h.DB.GetMessageByID(d.MessageID)
	if err != nil || msg == nil {
		return
	}

	// Only author or admin can delete
	if (msg.AuthorID == nil || *msg.AuthorID != c.UserID) && !c.User.IsAdmin {
		return
	}

	channelID := msg.ChannelID
	if err := h.DB.DeleteMessage(d.MessageID); err != nil {
		log.Printf("delete message: %v", err)
		return
	}

	broadcast, _ := NewMessage("message_delete", MessageDeletePayload{
		ID:        d.MessageID,
		ChannelID: channelID,
	})
	h.BroadcastAll(broadcast)
}

func isValidEmoji(s string) bool {
	r := []rune(s)
	return len(r) >= 1 && len(r) <= 10 && len(s) <= 32
}

func (h *Hub) handleAddReaction(c *Client, data json.RawMessage) {
	var d ReactionData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !isValidEmoji(d.Emoji) {
		return
	}

	msg, _ := h.DB.GetMessageByID(d.MessageID)
	if msg == nil || msg.DeletedAt != nil {
		return
	}

	if err := h.DB.AddReaction(d.MessageID, c.UserID, d.Emoji); err != nil {
		log.Printf("add reaction: %v", err)
		return
	}

	broadcast, _ := NewMessage("reaction_add", ReactionAddPayload{
		MessageID: d.MessageID,
		UserID:    c.UserID,
		Emoji:     d.Emoji,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleRemoveReaction(c *Client, data json.RawMessage) {
	var d ReactionData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if err := h.DB.RemoveReaction(d.MessageID, c.UserID, d.Emoji); err != nil {
		log.Printf("remove reaction: %v", err)
		return
	}

	broadcast, _ := NewMessage("reaction_remove", ReactionRemovePayload{
		MessageID: d.MessageID,
		UserID:    c.UserID,
		Emoji:     d.Emoji,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleTypingStart(c *Client, data json.RawMessage) {
	var d TypingData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	broadcast, _ := NewMessage("typing_start", TypingStartPayload{
		ChannelID: d.ChannelID,
		UserID:    c.UserID,
	})
	h.BroadcastExcept(broadcast, c.UserID)
}

func (h *Hub) canManageChannel(c *Client, channelID string) bool {
	if c.User.IsAdmin {
		return true
	}
	isManager, err := h.DB.IsChannelManager(channelID, c.UserID)
	if err != nil {
		return false
	}
	return isManager
}

func (h *Hub) handleCreateChannel(c *Client, data json.RawMessage) {
	var d CreateChannelData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if d.Name == "" || len(d.Name) > 32 {
		return
	}
	if d.Type != "voice" && d.Type != "text" {
		return
	}

	chID := uuid.New().String()
	ch, err := h.DB.CreateChannel(chID, d.Name, d.Type, c.UserID)
	if err != nil {
		log.Printf("create channel: %v", err)
		return
	}

	broadcast, _ := NewMessage("channel_create", ChannelPayload{
		ID:         ch.ID,
		Name:       ch.Name,
		Type:       ch.Type,
		Position:   ch.Position,
		ManagerIDs: []string{c.UserID},
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleDeleteChannel(c *Client, data json.RawMessage) {
	var d DeleteChannelData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageChannel(c, d.ChannelID) {
		return
	}

	// Kick all voice users and stop screen share if this is a voice channel
	if h.SFU != nil {
		if room := h.SFU.GetRoom(d.ChannelID); room != nil {
			for _, userID := range room.PeerIDs() {
				room.RemovePeer(userID)
				vsMsg, _ := NewMessage("voice_state_update", VoiceStatePayload{
					UserID:    userID,
					ChannelID: "",
				})
				h.BroadcastAll(vsMsg)
			}
		}
		// Stop screen share in this channel
		h.SFU.StopScreenShare(d.ChannelID)
	}

	if err := h.DB.DeleteChannel(d.ChannelID); err != nil {
		log.Printf("delete channel: %v", err)
		return
	}

	broadcast, _ := NewMessage("channel_delete", ChannelDeletePayload{
		ChannelID: d.ChannelID,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleRenameChannel(c *Client, data json.RawMessage) {
	var d RenameChannelData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	name := strings.TrimSpace(d.Name)
	if name == "" || len(name) > 32 {
		return
	}

	if !h.canManageChannel(c, d.ChannelID) {
		return
	}

	if err := h.DB.RenameChannel(d.ChannelID, name); err != nil {
		log.Printf("rename channel: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetChannelManagers(d.ChannelID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	broadcast, _ := NewMessage("channel_update", ChannelUpdatePayload{
		ID:         d.ChannelID,
		Name:       name,
		ManagerIDs: managerIDs,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleRestoreChannel(c *Client, data json.RawMessage) {
	var d RestoreChannelData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !c.User.IsAdmin {
		return
	}

	if err := h.DB.RestoreChannel(d.ChannelID); err != nil {
		log.Printf("restore channel: %v", err)
		return
	}

	ch, err := h.DB.GetChannelByID(d.ChannelID)
	if err != nil {
		log.Printf("get restored channel: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetChannelManagers(d.ChannelID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	broadcast, _ := NewMessage("channel_create", ChannelPayload{
		ID:         ch.ID,
		Name:       ch.Name,
		Type:       ch.Type,
		Position:   ch.Position,
		ManagerIDs: managerIDs,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleAddChannelManager(c *Client, data json.RawMessage) {
	var d ChannelManagerData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageChannel(c, d.ChannelID) {
		return
	}

	if err := h.DB.AddChannelManager(d.ChannelID, d.UserID); err != nil {
		log.Printf("add channel manager: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetChannelManagers(d.ChannelID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	ch, err := h.DB.GetChannelByID(d.ChannelID)
	if err != nil {
		return
	}

	broadcast, _ := NewMessage("channel_update", ChannelUpdatePayload{
		ID:         d.ChannelID,
		Name:       ch.Name,
		ManagerIDs: managerIDs,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleRemoveChannelManager(c *Client, data json.RawMessage) {
	var d ChannelManagerData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageChannel(c, d.ChannelID) {
		return
	}

	if err := h.DB.RemoveChannelManager(d.ChannelID, d.UserID); err != nil {
		log.Printf("remove channel manager: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetChannelManagers(d.ChannelID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	ch, err := h.DB.GetChannelByID(d.ChannelID)
	if err != nil {
		return
	}

	broadcast, _ := NewMessage("channel_update", ChannelUpdatePayload{
		ID:         d.ChannelID,
		Name:       ch.Name,
		ManagerIDs: managerIDs,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleReorderChannels(c *Client, data json.RawMessage) {
	if !c.User.IsAdmin {
		return
	}

	var d ReorderChannelsData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if err := h.DB.ReorderChannels(d.ChannelIDs); err != nil {
		log.Printf("reorder channels: %v", err)
		return
	}

	broadcast, _ := NewMessage("channel_reorder", ChannelReorderPayload{
		ChannelIDs: d.ChannelIDs,
	})
	h.BroadcastAll(broadcast)
}

// --- Voice handlers ---

type JoinVoiceData struct {
	ChannelID string `json:"channel_id"`
}

type WebRTCAnswerData struct {
	SDP string `json:"sdp"`
}

type WebRTCICEData struct {
	Candidate webrtc.ICECandidateInit `json:"candidate"`
}

type VoiceMuteData struct {
	Muted bool `json:"muted"`
}

type VoiceDeafenData struct {
	Deafened bool `json:"deafened"`
}

type VoiceSpeakingData struct {
	Speaking bool `json:"speaking"`
}

type VoiceServerMuteData struct {
	UserID string `json:"user_id"`
	Muted  bool   `json:"muted"`
}

func (h *Hub) handleJoinVoice(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d JoinVoiceData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	// Verify channel exists and is voice type
	ch, err := h.DB.GetChannelByID(d.ChannelID)
	if err != nil || ch == nil || ch.Type != "voice" {
		return
	}

	// Leave current room if in one
	if currentRoom := h.SFU.GetUserRoom(c.UserID); currentRoom != nil {
		currentRoom.RemovePeer(c.UserID)
		// Broadcast leave
		leaveMsg, _ := NewMessage("voice_state_update", VoiceStatePayload{
			UserID:    c.UserID,
			ChannelID: "",
		})
		h.BroadcastAll(leaveMsg)
	}

	// Join new room
	room := h.SFU.GetOrCreateRoom(d.ChannelID)
	_, err = room.AddPeer(c.UserID)
	if err != nil {
		log.Printf("sfu: add peer %s to room %s: %v", c.UserID, d.ChannelID, err)
		return
	}

	// Broadcast voice_state_update (joined)
	joinMsg, _ := NewMessage("voice_state_update", VoiceStatePayload{
		UserID:    c.UserID,
		ChannelID: d.ChannelID,
	})
	h.BroadcastAll(joinMsg)
}

func (h *Hub) handleLeaveVoice(c *Client) {
	if h.SFU == nil {
		return
	}

	// Auto-stop screen share if presenter leaves voice
	// StopScreenShare triggers OnScreenShareStopped callback which broadcasts
	if sr := h.SFU.GetUserScreenRoom(c.UserID); sr != nil {
		h.SFU.StopScreenShare(sr.ChannelID)
	}

	room := h.SFU.GetUserRoom(c.UserID)
	if room != nil {
		room.RemovePeer(c.UserID)
	}

	// Always broadcast the leave, even if the peer was already removed
	// by a connection state change callback
	msg, _ := NewMessage("voice_state_update", VoiceStatePayload{
		UserID:    c.UserID,
		ChannelID: "",
	})
	h.BroadcastAll(msg)
}

func (h *Hub) handleWebRTCAnswer(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d WebRTCAnswerData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	room := h.SFU.GetUserRoom(c.UserID)
	if room == nil {
		return
	}

	room.HandleAnswer(c.UserID, d.SDP)
}

func (h *Hub) handleWebRTCICE(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d WebRTCICEData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	room := h.SFU.GetUserRoom(c.UserID)
	if room == nil {
		return
	}

	room.HandleICE(c.UserID, d.Candidate)
}

func (h *Hub) handleVoiceSelfMute(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d VoiceMuteData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	room := h.SFU.GetUserRoom(c.UserID)
	if room == nil {
		return
	}

	peer := room.GetPeer(c.UserID)
	if peer == nil {
		return
	}

	peer.SetSelfMute(d.Muted)
	vs := peer.VoiceState()
	msg, _ := NewMessage("voice_state_update", VoiceStatePayload{
		UserID:     vs.UserID,
		ChannelID:  vs.ChannelID,
		SelfMute:   vs.SelfMute,
		SelfDeafen: vs.SelfDeafen,
		ServerMute: vs.ServerMute,
		Speaking:   vs.Speaking,
	})
	h.BroadcastAll(msg)
}

func (h *Hub) handleVoiceSelfDeafen(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d VoiceDeafenData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	room := h.SFU.GetUserRoom(c.UserID)
	if room == nil {
		return
	}

	peer := room.GetPeer(c.UserID)
	if peer == nil {
		return
	}

	peer.SetSelfDeafen(d.Deafened)
	vs := peer.VoiceState()
	msg, _ := NewMessage("voice_state_update", VoiceStatePayload{
		UserID:     vs.UserID,
		ChannelID:  vs.ChannelID,
		SelfMute:   vs.SelfMute,
		SelfDeafen: vs.SelfDeafen,
		ServerMute: vs.ServerMute,
		Speaking:   vs.Speaking,
	})
	h.BroadcastAll(msg)
}

func (h *Hub) handleVoiceSpeaking(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d VoiceSpeakingData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	room := h.SFU.GetUserRoom(c.UserID)
	if room == nil {
		return
	}

	peer := room.GetPeer(c.UserID)
	if peer == nil {
		return
	}

	peer.SetSpeaking(d.Speaking)
	vs := peer.VoiceState()
	msg, _ := NewMessage("voice_state_update", VoiceStatePayload{
		UserID:     vs.UserID,
		ChannelID:  vs.ChannelID,
		SelfMute:   vs.SelfMute,
		SelfDeafen: vs.SelfDeafen,
		ServerMute: vs.ServerMute,
		Speaking:   vs.Speaking,
	})
	h.BroadcastAll(msg)
}

// --- Notification handlers ---

type MarkNotificationReadData struct {
	ID string `json:"id"`
}

func (h *Hub) handleMarkNotificationRead(c *Client, data json.RawMessage) {
	var d MarkNotificationReadData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}
	if err := h.DB.MarkNotificationRead(d.ID, c.UserID); err != nil {
		log.Printf("mark notification read: %v", err)
	}
}

func (h *Hub) handleMarkAllNotificationsRead(c *Client) {
	if err := h.DB.MarkAllNotificationsRead(c.UserID); err != nil {
		log.Printf("mark all notifications read: %v", err)
	}
}

// --- Screen share handlers ---

type ScreenShareSubscribeData struct {
	ChannelID string `json:"channel_id"`
}

type ScreenShareUnsubscribeData struct {
	ChannelID string `json:"channel_id"`
}

type WebRTCScreenAnswerData struct {
	SDP  string `json:"sdp"`
	Role string `json:"role"`
}

type WebRTCScreenICEData struct {
	Candidate webrtc.ICECandidateInit `json:"candidate"`
	Role      string                  `json:"role"`
}

type ScreenSharePayload struct {
	UserID    string `json:"user_id"`
	ChannelID string `json:"channel_id"`
}

type ScreenShareErrorPayload struct {
	Error string `json:"error"`
}

func (h *Hub) handleScreenShareStart(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	// Must be in a voice channel
	room := h.SFU.GetUserRoom(c.UserID)
	if room == nil {
		msg, _ := NewMessage("screen_share_error", ScreenShareErrorPayload{
			Error: "must be in a voice channel to share screen",
		})
		c.Send(msg)
		return
	}

	channelID := room.ChannelID

	sr, err := h.SFU.StartScreenShare(channelID, c.UserID)
	if err != nil {
		log.Printf("screen share start: %v", err)
		msg, _ := NewMessage("screen_share_error", ScreenShareErrorPayload{
			Error: err.Error(),
		})
		c.Send(msg)
		return
	}
	_ = sr

	broadcast, _ := NewMessage("screen_share_started", ScreenSharePayload{
		UserID:    c.UserID,
		ChannelID: channelID,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleScreenShareStop(c *Client) {
	if h.SFU == nil {
		return
	}

	sr := h.SFU.GetUserScreenRoom(c.UserID)
	if sr == nil {
		return
	}

	// StopScreenShare triggers OnScreenShareStopped callback which broadcasts
	h.SFU.StopScreenShare(sr.ChannelID)
}

func (h *Hub) handleScreenShareSubscribe(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d ScreenShareSubscribeData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	sr := h.SFU.GetScreenRoom(d.ChannelID)
	if sr == nil {
		msg, _ := NewMessage("screen_share_error", ScreenShareErrorPayload{
			Error: "no active screen share in this channel",
		})
		c.Send(msg)
		return
	}

	if err := sr.AddViewer(c.UserID); err != nil {
		log.Printf("screen share subscribe: %v", err)
		return
	}
}

func (h *Hub) handleScreenShareUnsubscribe(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d ScreenShareUnsubscribeData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	sr := h.SFU.GetScreenRoom(d.ChannelID)
	if sr == nil {
		return
	}

	sr.RemoveViewer(c.UserID)
}

func (h *Hub) handleWebRTCScreenAnswer(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d WebRTCScreenAnswerData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	h.SFU.HandleScreenAnswer(c.UserID, d.SDP, d.Role)
}

func (h *Hub) handleWebRTCScreenICE(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	var d WebRTCScreenICEData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	h.SFU.HandleScreenICE(c.UserID, d.Candidate, d.Role)
}

func (h *Hub) handleVoiceServerMute(c *Client, data json.RawMessage) {
	if h.SFU == nil {
		return
	}

	// Admin only
	if !c.User.IsAdmin {
		return
	}

	var d VoiceServerMuteData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	room := h.SFU.GetUserRoom(d.UserID)
	if room == nil {
		return
	}

	peer := room.GetPeer(d.UserID)
	if peer == nil {
		return
	}

	peer.SetServerMute(d.Muted)
	vs := peer.VoiceState()
	msg, _ := NewMessage("voice_state_update", VoiceStatePayload{
		UserID:     vs.UserID,
		ChannelID:  vs.ChannelID,
		SelfMute:   vs.SelfMute,
		SelfDeafen: vs.SelfDeafen,
		ServerMute: vs.ServerMute,
		Speaking:   vs.Speaking,
	})
	h.BroadcastAll(msg)
}

// --- Radio handlers ---

type RadioStationManagerData struct {
	StationID string `json:"station_id"`
	UserID    string `json:"user_id"`
}

type RadioStationUpdatePayload struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	PlaybackMode string   `json:"playback_mode"`
	ManagerIDs   []string `json:"manager_ids"`
}

func (h *Hub) canManageRadioStation(c *Client, stationID string) bool {
	if c.User.IsAdmin {
		return true
	}
	isManager, err := h.DB.IsRadioStationManager(stationID, c.UserID)
	if err != nil {
		return false
	}
	return isManager
}

type CreateRadioStationData struct {
	Name string `json:"name"`
}

type DeleteRadioStationData struct {
	StationID string `json:"station_id"`
}

type RenameRadioStationData struct {
	StationID string `json:"station_id"`
	Name      string `json:"name"`
}

type CreateRadioPlaylistData struct {
	Name      string `json:"name"`
	StationID string `json:"station_id"`
}

type DeleteRadioPlaylistData struct {
	PlaylistID string `json:"playlist_id"`
}

type ReorderRadioTracksData struct {
	PlaylistID string   `json:"playlist_id"`
	TrackIDs   []string `json:"track_ids"`
}

type RadioPlayData struct {
	StationID  string `json:"station_id"`
	PlaylistID string `json:"playlist_id"`
}

type RadioPauseData struct {
	StationID string  `json:"station_id"`
	Position  float64 `json:"position"`
}

type RadioSeekData struct {
	StationID string  `json:"station_id"`
	Position  float64 `json:"position"`
}

type RadioNextData struct {
	StationID string `json:"station_id"`
}

type RadioStopData struct {
	StationID string `json:"station_id"`
}

type RadioTrackEndedData struct {
	StationID string `json:"station_id"`
}

func (h *Hub) handleCreateRadioStation(c *Client, data json.RawMessage) {
	var d CreateRadioStationData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	name := strings.TrimSpace(d.Name)
	if name == "" || len(name) > 32 {
		return
	}

	stationID := uuid.New().String()
	station, err := h.DB.CreateRadioStation(stationID, name, c.UserID)
	if err != nil {
		log.Printf("create radio station: %v", err)
		return
	}

	broadcast, _ := NewMessage("radio_station_create", RadioStationPayload{
		ID:           station.ID,
		Name:         station.Name,
		CreatedBy:    station.CreatedBy,
		Position:     station.Position,
		PlaybackMode: "play_all",
		ManagerIDs:   []string{c.UserID},
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleDeleteRadioStation(c *Client, data json.RawMessage) {
	var d DeleteRadioStationData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil || station == nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	// Clear playback if active
	h.ClearRadioPlayback(d.StationID)

	if err := h.DB.DeleteRadioStation(d.StationID); err != nil {
		log.Printf("delete radio station: %v", err)
		return
	}

	broadcast, _ := NewMessage("radio_station_delete", map[string]string{"station_id": d.StationID})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleRenameRadioStation(c *Client, data json.RawMessage) {
	var d RenameRadioStationData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	name := strings.TrimSpace(d.Name)
	if name == "" || len(name) > 32 {
		return
	}

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil || station == nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	if err := h.DB.UpdateRadioStationName(d.StationID, name); err != nil {
		log.Printf("rename radio station: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetRadioStationManagers(d.StationID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	broadcast, _ := NewMessage("radio_station_update", RadioStationUpdatePayload{
		ID:           station.ID,
		Name:         name,
		PlaybackMode: station.PlaybackMode,
		ManagerIDs:   managerIDs,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleCreateRadioPlaylist(c *Client, data json.RawMessage) {
	var d CreateRadioPlaylistData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	name := strings.TrimSpace(d.Name)
	if name == "" || len(name) > 64 {
		return
	}

	var stationID *string
	if d.StationID != "" {
		stationID = &d.StationID
	}

	playlistID := uuid.New().String()
	playlist, err := h.DB.CreateRadioPlaylist(playlistID, name, c.UserID, stationID)
	if err != nil {
		log.Printf("create radio playlist: %v", err)
		return
	}

	sid := ""
	if playlist.StationID != nil {
		sid = *playlist.StationID
	}
	reply, _ := NewMessage("radio_playlist_created", RadioPlaylistPayload{
		ID:        playlist.ID,
		Name:      playlist.Name,
		UserID:    playlist.UserID,
		StationID: sid,
		Tracks:    []RadioTrackPayload{},
	})
	h.BroadcastAll(reply)
}

func (h *Hub) handleDeleteRadioPlaylist(c *Client, data json.RawMessage) {
	var d DeleteRadioPlaylistData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	playlist, err := h.DB.GetPlaylistByID(d.PlaylistID)
	if err != nil || playlist.UserID != c.UserID {
		return
	}

	// Stop any station playing this playlist
	cleared := h.ClearRadioPlaybackByPlaylist(d.PlaylistID)
	for _, sid := range cleared {
		msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": sid, "stopped": true})
		h.BroadcastToRadioListeners(sid, msg)
		h.BroadcastRadioStopped(sid)
	}

	if err := h.DB.DeleteRadioPlaylist(d.PlaylistID); err != nil {
		log.Printf("delete radio playlist: %v", err)
		return
	}

	reply, _ := NewMessage("radio_playlist_deleted", map[string]string{"playlist_id": d.PlaylistID})
	h.BroadcastAll(reply)
}

func (h *Hub) handleReorderRadioTracks(c *Client, data json.RawMessage) {
	var d ReorderRadioTracksData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	playlist, err := h.DB.GetPlaylistByID(d.PlaylistID)
	if err != nil || playlist.UserID != c.UserID {
		return
	}

	if err := h.DB.ReorderRadioTracks(d.PlaylistID, d.TrackIDs); err != nil {
		log.Printf("reorder radio tracks: %v", err)
		return
	}

	// Send updated track list back to sender
	h.sendPlaylistTracks(c, d.PlaylistID)
}

func (h *Hub) sendPlaylistTracks(c *Client, playlistID string) {
	tracks, err := h.DB.GetTracksByPlaylist(playlistID)
	if err != nil {
		return
	}
	trackPayloads := make([]RadioTrackPayload, len(tracks))
	for i, t := range tracks {
		trackPayloads[i] = RadioTrackPayload{
			ID:       t.ID,
			Filename: t.Filename,
			URL:      "/" + strings.ReplaceAll(t.Path, "\\", "/"),
			Duration: t.Duration,
			Position: t.Position,
			Waveform: t.Waveform,
		}
	}
	reply, _ := NewMessage("radio_playlist_tracks", map[string]interface{}{
		"playlist_id": playlistID,
		"tracks":      trackPayloads,
	})
	h.BroadcastAll(reply)
}

func (h *Hub) buildTrackPayloads(playlistID string) []RadioTrackPayload {
	tracks, err := h.DB.GetTracksByPlaylist(playlistID)
	if err != nil {
		return nil
	}
	payloads := make([]RadioTrackPayload, len(tracks))
	for i, t := range tracks {
		payloads[i] = RadioTrackPayload{
			ID:       t.ID,
			Filename: t.Filename,
			URL:      "/" + strings.ReplaceAll(t.Path, "\\", "/"),
			Duration: t.Duration,
			Position: t.Position,
			Waveform: t.Waveform,
		}
	}
	return payloads
}

func (h *Hub) handleRadioPlay(c *Client, data json.RawMessage) {
	var d RadioPlayData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	// Verify station exists
	_, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil {
		return
	}

	// Verify playlist exists
	playlist, err := h.DB.GetPlaylistByID(d.PlaylistID)
	if err != nil || playlist == nil {
		return
	}

	// Load tracks
	trackPayloads := h.buildTrackPayloads(d.PlaylistID)
	if len(trackPayloads) == 0 {
		return
	}

	state := &RadioPlaybackState{
		StationID:  d.StationID,
		PlaylistID: d.PlaylistID,
		TrackIndex: 0,
		Playing:    true,
		Position:   0,
		UpdatedAt:  nowUnix(),
		UserID:     c.UserID,
		Tracks:     trackPayloads,
	}
	h.SetRadioPlayback(d.StationID, state)

	msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
		StationID:  d.StationID,
		PlaylistID: d.PlaylistID,
		TrackIndex: 0,
		Track:      trackPayloads[0],
		Playing:    true,
		Position:   0,
		UpdatedAt:  state.UpdatedAt,
		UserID:     c.UserID,
	})
	h.BroadcastToRadioListeners(d.StationID, msg)
	h.BroadcastRadioStatus(d.StationID, true, trackPayloads[0].Filename, c.UserID)
}

func (h *Hub) handleRadioPause(c *Client, data json.RawMessage) {
	var d RadioPauseData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	state := h.GetRadioPlayback(d.StationID)
	if state == nil {
		return
	}

	h.radioMu.Lock()
	state.Playing = false
	state.Position = d.Position
	state.UpdatedAt = nowUnix()
	h.radioMu.Unlock()

	var track RadioTrackPayload
	if state.TrackIndex >= 0 && state.TrackIndex < len(state.Tracks) {
		track = state.Tracks[state.TrackIndex]
	}

	msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
		StationID:  state.StationID,
		PlaylistID: state.PlaylistID,
		TrackIndex: state.TrackIndex,
		Track:      track,
		Playing:    false,
		Position:   state.Position,
		UpdatedAt:  state.UpdatedAt,
		UserID:     state.UserID,
	})
	h.BroadcastToRadioListeners(state.StationID, msg)
	h.BroadcastRadioStatus(state.StationID, false, track.Filename, state.UserID)
}

func (h *Hub) handleRadioResume(c *Client, data json.RawMessage) {
	var d struct {
		StationID string `json:"station_id"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	state := h.GetRadioPlayback(d.StationID)
	if state == nil {
		return
	}

	h.radioMu.Lock()
	state.Playing = true
	state.UpdatedAt = nowUnix()
	h.radioMu.Unlock()

	var track RadioTrackPayload
	if state.TrackIndex >= 0 && state.TrackIndex < len(state.Tracks) {
		track = state.Tracks[state.TrackIndex]
	}

	msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
		StationID:  state.StationID,
		PlaylistID: state.PlaylistID,
		TrackIndex: state.TrackIndex,
		Track:      track,
		Playing:    true,
		Position:   state.Position,
		UpdatedAt:  state.UpdatedAt,
		UserID:     state.UserID,
	})
	h.BroadcastToRadioListeners(state.StationID, msg)
	h.BroadcastRadioStatus(state.StationID, true, track.Filename, state.UserID)
}

func (h *Hub) handleRadioSeek(c *Client, data json.RawMessage) {
	var d RadioSeekData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	state := h.GetRadioPlayback(d.StationID)
	if state == nil {
		return
	}

	h.radioMu.Lock()
	state.Position = d.Position
	state.UpdatedAt = nowUnix()
	h.radioMu.Unlock()

	var track RadioTrackPayload
	if state.TrackIndex >= 0 && state.TrackIndex < len(state.Tracks) {
		track = state.Tracks[state.TrackIndex]
	}

	msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
		StationID:  state.StationID,
		PlaylistID: state.PlaylistID,
		TrackIndex: state.TrackIndex,
		Track:      track,
		Playing:    state.Playing,
		Position:   state.Position,
		UpdatedAt:  state.UpdatedAt,
		UserID:     state.UserID,
	})
	h.BroadcastToRadioListeners(state.StationID, msg)
}

func (h *Hub) handleRadioNext(c *Client, data json.RawMessage) {
	var d RadioNextData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	state := h.GetRadioPlayback(d.StationID)
	if state == nil {
		return
	}

	h.radioMu.Lock()
	nextIndex := state.TrackIndex + 1
	if nextIndex < len(state.Tracks) {
		// More tracks in current playlist
		state.TrackIndex = nextIndex
		state.Position = 0
		state.Playing = true
		state.UpdatedAt = nowUnix()
		track := state.Tracks[nextIndex]
		h.radioMu.Unlock()

		msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
			StationID:  state.StationID,
			PlaylistID: state.PlaylistID,
			TrackIndex: nextIndex,
			Track:      track,
			Playing:    true,
			Position:   0,
			UpdatedAt:  state.UpdatedAt,
			UserID:     state.UserID,
		})
		h.BroadcastToRadioListeners(state.StationID, msg)
		h.BroadcastRadioStatus(state.StationID, true, track.Filename, state.UserID)
		return
	}

	// Last track — use playback mode logic
	playlistID := state.PlaylistID
	userID := state.UserID
	h.radioMu.Unlock()

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil || station == nil {
		h.ClearRadioPlayback(d.StationID)
		msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": d.StationID, "stopped": true})
		h.BroadcastToRadioListeners(d.StationID, msg)
		h.BroadcastRadioStopped(d.StationID)
		return
	}

	h.advancePlaybackMode(d.StationID, playlistID, userID, station.PlaybackMode)
}

func (h *Hub) handleRadioStop(c *Client, data json.RawMessage) {
	var d RadioStopData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	state := h.GetRadioPlayback(d.StationID)
	if state == nil {
		return
	}

	h.ClearRadioPlayback(d.StationID)
	msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": d.StationID, "stopped": true})
	h.BroadcastToRadioListeners(d.StationID, msg)
	h.BroadcastRadioStopped(d.StationID)
}

func (h *Hub) handleRadioTrackEnded(c *Client, data json.RawMessage) {
	var d RadioTrackEndedData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	h.radioMu.Lock()
	state := h.radioPlayback[d.StationID]
	if state == nil {
		h.radioMu.Unlock()
		return
	}

	nextIndex := state.TrackIndex + 1
	if nextIndex < len(state.Tracks) {
		// More tracks in current playlist — advance
		state.TrackIndex = nextIndex
		state.Position = 0
		state.Playing = true
		state.UpdatedAt = nowUnix()
		track := state.Tracks[nextIndex]
		h.radioMu.Unlock()

		msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
			StationID:  state.StationID,
			PlaylistID: state.PlaylistID,
			TrackIndex: nextIndex,
			Track:      track,
			Playing:    true,
			Position:   0,
			UpdatedAt:  state.UpdatedAt,
			UserID:     state.UserID,
		})
		h.BroadcastToRadioListeners(state.StationID, msg)
		h.BroadcastRadioStatus(state.StationID, true, track.Filename, state.UserID)
		return
	}

	// Last track in playlist — check playback mode
	playlistID := state.PlaylistID
	userID := state.UserID
	h.radioMu.Unlock()

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil || station == nil {
		h.ClearRadioPlayback(d.StationID)
		msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": d.StationID, "stopped": true})
		h.BroadcastToRadioListeners(d.StationID, msg)
		h.BroadcastRadioStopped(d.StationID)
		return
	}

	h.advancePlaybackMode(d.StationID, playlistID, userID, station.PlaybackMode)
}

// advancePlaybackMode handles what happens when a playlist finishes, based on the station's playback mode.
func (h *Hub) advancePlaybackMode(stationID, playlistID, userID, mode string) {
	switch mode {
	case "loop_one":
		// Restart current playlist
		tracks := h.buildTrackPayloads(playlistID)
		if len(tracks) == 0 {
			h.ClearRadioPlayback(stationID)
			msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": stationID, "stopped": true})
			h.BroadcastToRadioListeners(stationID, msg)
			h.BroadcastRadioStopped(stationID)
			return
		}
		state := &RadioPlaybackState{
			StationID:  stationID,
			PlaylistID: playlistID,
			TrackIndex: 0,
			Playing:    true,
			Position:   0,
			UpdatedAt:  nowUnix(),
			UserID:     userID,
			Tracks:     tracks,
		}
		h.SetRadioPlayback(stationID, state)
		msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
			StationID:  stationID,
			PlaylistID: playlistID,
			TrackIndex: 0,
			Track:      tracks[0],
			Playing:    true,
			Position:   0,
			UpdatedAt:  state.UpdatedAt,
			UserID:     userID,
		})
		h.BroadcastToRadioListeners(stationID, msg)
		h.BroadcastRadioStatus(stationID, true, tracks[0].Filename, userID)

	case "play_all":
		// Advance to next playlist, stop if none
		nextPL, tracks, ok := h.getNextPlaylistTracks(stationID, playlistID, false)
		if !ok {
			h.ClearRadioPlayback(stationID)
			msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": stationID, "stopped": true})
			h.BroadcastToRadioListeners(stationID, msg)
			h.BroadcastRadioStopped(stationID)
			return
		}
		state := &RadioPlaybackState{
			StationID:  stationID,
			PlaylistID: nextPL,
			TrackIndex: 0,
			Playing:    true,
			Position:   0,
			UpdatedAt:  nowUnix(),
			UserID:     userID,
			Tracks:     tracks,
		}
		h.SetRadioPlayback(stationID, state)
		msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
			StationID:  stationID,
			PlaylistID: nextPL,
			TrackIndex: 0,
			Track:      tracks[0],
			Playing:    true,
			Position:   0,
			UpdatedAt:  state.UpdatedAt,
			UserID:     userID,
		})
		h.BroadcastToRadioListeners(stationID, msg)
		h.BroadcastRadioStatus(stationID, true, tracks[0].Filename, userID)

	case "loop_all":
		// Advance to next playlist, wrap around
		nextPL, tracks, ok := h.getNextPlaylistTracks(stationID, playlistID, true)
		if !ok {
			// Only one playlist (or no tracks) — loop current
			tracks = h.buildTrackPayloads(playlistID)
			if len(tracks) == 0 {
				h.ClearRadioPlayback(stationID)
				msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": stationID, "stopped": true})
				h.BroadcastToRadioListeners(stationID, msg)
				h.BroadcastRadioStopped(stationID)
				return
			}
			nextPL = playlistID
		}
		state := &RadioPlaybackState{
			StationID:  stationID,
			PlaylistID: nextPL,
			TrackIndex: 0,
			Playing:    true,
			Position:   0,
			UpdatedAt:  nowUnix(),
			UserID:     userID,
			Tracks:     tracks,
		}
		h.SetRadioPlayback(stationID, state)
		msg, _ := NewMessage("radio_playback", &RadioPlaybackPayload{
			StationID:  stationID,
			PlaylistID: nextPL,
			TrackIndex: 0,
			Track:      tracks[0],
			Playing:    true,
			Position:   0,
			UpdatedAt:  state.UpdatedAt,
			UserID:     userID,
		})
		h.BroadcastToRadioListeners(stationID, msg)
		h.BroadcastRadioStatus(stationID, true, tracks[0].Filename, userID)

	default: // "single" or unknown
		h.ClearRadioPlayback(stationID)
		msg, _ := NewMessage("radio_playback", map[string]interface{}{"station_id": stationID, "stopped": true})
		h.BroadcastToRadioListeners(stationID, msg)
		h.BroadcastRadioStopped(stationID)
	}
}

func (h *Hub) handleRadioTune(c *Client, data json.RawMessage) {
	var d struct {
		StationID string `json:"station_id"`
	}
	if err := json.Unmarshal(data, &d); err != nil || d.StationID == "" {
		return
	}
	h.SetRadioListener(c.UserID, d.StationID)
	h.broadcastRadioListeners(d.StationID)
}

func (h *Hub) handleRadioUntune(c *Client) {
	// Find which station they were on and broadcast the update
	h.removeRadioListener(c.UserID)
}

func (h *Hub) handleAddRadioStationManager(c *Client, data json.RawMessage) {
	var d RadioStationManagerData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	if err := h.DB.AddRadioStationManager(d.StationID, d.UserID); err != nil {
		log.Printf("add radio station manager: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetRadioStationManagers(d.StationID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil {
		return
	}

	broadcast, _ := NewMessage("radio_station_update", RadioStationUpdatePayload{
		ID:           d.StationID,
		Name:         station.Name,
		PlaybackMode: station.PlaybackMode,
		ManagerIDs:   managerIDs,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleRemoveRadioStationManager(c *Client, data json.RawMessage) {
	var d RadioStationManagerData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	// Prevent orphaning — must keep at least one manager
	currentManagers, _ := h.DB.GetRadioStationManagers(d.StationID)
	if len(currentManagers) <= 1 {
		return
	}

	if err := h.DB.RemoveRadioStationManager(d.StationID, d.UserID); err != nil {
		log.Printf("remove radio station manager: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetRadioStationManagers(d.StationID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil {
		return
	}

	broadcast, _ := NewMessage("radio_station_update", RadioStationUpdatePayload{
		ID:           d.StationID,
		Name:         station.Name,
		PlaybackMode: station.PlaybackMode,
		ManagerIDs:   managerIDs,
	})
	h.BroadcastAll(broadcast)
}

// --- Set radio station playback mode ---

type SetRadioStationModeData struct {
	StationID string `json:"station_id"`
	Mode      string `json:"mode"`
}

func (h *Hub) handleSetRadioStationMode(c *Client, data json.RawMessage) {
	var d SetRadioStationModeData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	// Validate mode
	switch d.Mode {
	case "play_all", "loop_one", "loop_all", "single":
	default:
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil || station == nil {
		return
	}

	if err := h.DB.UpdateRadioStationPlaybackMode(d.StationID, d.Mode); err != nil {
		log.Printf("update radio station playback mode: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetRadioStationManagers(d.StationID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	broadcast, _ := NewMessage("radio_station_update", RadioStationUpdatePayload{
		ID:           d.StationID,
		Name:         station.Name,
		PlaybackMode: d.Mode,
		ManagerIDs:   managerIDs,
	})
	h.BroadcastAll(broadcast)
}

// getNextPlaylistTracks finds the next playlist with tracks after currentPlaylistID for a station.
// Returns the playlist ID, its tracks, and whether one was found.
func (h *Hub) getNextPlaylistTracks(stationID, currentPlaylistID string, wrap bool) (string, []RadioTrackPayload, bool) {
	playlists, err := h.DB.GetPlaylistsByStation(stationID)
	if err != nil || len(playlists) == 0 {
		return "", nil, false
	}

	// Find index of current playlist
	currentIdx := -1
	for i, p := range playlists {
		if p.ID == currentPlaylistID {
			currentIdx = i
			break
		}
	}
	if currentIdx == -1 {
		return "", nil, false
	}

	// Search forward from current+1
	for i := 1; i < len(playlists); i++ {
		idx := currentIdx + i
		if idx >= len(playlists) {
			if !wrap {
				return "", nil, false
			}
			idx = idx % len(playlists)
		}
		tracks := h.buildTrackPayloads(playlists[idx].ID)
		if len(tracks) > 0 {
			return playlists[idx].ID, tracks, true
		}
	}
	return "", nil, false
}

// --- Media playback handlers ---

type MediaPlayData struct {
	VideoID  string  `json:"video_id"`
	Position float64 `json:"position"`
}

type MediaPauseData struct {
	Position float64 `json:"position"`
}

type MediaSeekData struct {
	Position float64 `json:"position"`
}

func (h *Hub) handleMediaPlay(c *Client, data json.RawMessage) {
	if !c.User.IsAdmin {
		return
	}

	var d MediaPlayData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	state := &MediaPlaybackState{
		VideoID:   d.VideoID,
		Playing:   true,
		Position:  d.Position,
		UpdatedAt: nowUnix(),
	}
	h.SetMediaPlayback(state)

	payload := h.GetMediaPlayback()
	msg, _ := NewMessage("media_playback", payload)
	h.BroadcastAll(msg)
}

func (h *Hub) handleMediaPause(c *Client, data json.RawMessage) {
	if !c.User.IsAdmin {
		return
	}

	var d MediaPauseData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	h.mediaMu.Lock()
	if h.mediaPlayback != nil {
		h.mediaPlayback.Playing = false
		h.mediaPlayback.Position = d.Position
		h.mediaPlayback.UpdatedAt = nowUnix()
	}
	h.mediaMu.Unlock()

	payload := h.GetMediaPlayback()
	if payload == nil {
		return
	}
	msg, _ := NewMessage("media_playback", payload)
	h.BroadcastAll(msg)
}

func (h *Hub) handleMediaSeek(c *Client, data json.RawMessage) {
	if !c.User.IsAdmin {
		return
	}

	var d MediaSeekData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	h.mediaMu.Lock()
	if h.mediaPlayback != nil {
		h.mediaPlayback.Position = d.Position
		h.mediaPlayback.UpdatedAt = nowUnix()
	}
	h.mediaMu.Unlock()

	payload := h.GetMediaPlayback()
	if payload == nil {
		return
	}
	msg, _ := NewMessage("media_playback", payload)
	h.BroadcastAll(msg)
}

func (h *Hub) handleMediaStop(c *Client) {
	if !c.User.IsAdmin {
		return
	}

	h.SetMediaPlayback(nil)

	msg, _ := NewMessage("media_playback", nil)
	h.BroadcastAll(msg)
}
