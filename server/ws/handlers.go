package ws

import (
	"encoding/json"
	"log"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/unfurl"
	"github.com/pion/webrtc/v4"
)

// Client → Server data types

type SendMessageData struct {
	ChannelID     string   `json:"channel_id"`
	Content       *string  `json:"content"`
	ReplyToID     *string  `json:"reply_to_id"`
	AttachmentIDs []string `json:"attachment_ids"`
	ThreadID      *string  `json:"thread_id"`
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
	ThreadID    *string                 `json:"thread_id"`
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
	if d.Content != nil && len(*d.Content) > 32000 {
		return
	}

	// Verify channel exists
	ch, err := h.DB.GetChannelByID(d.ChannelID)
	if err != nil || ch == nil || ch.Type != "text" {
		return
	}

	// Membership enforcement for non-public channels
	if ch.Visibility != "public" {
		isMember, _ := h.DB.IsChannelMember(d.ChannelID, c.UserID)
		if !isMember && !c.User.IsAdmin {
			return
		}
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

	// Thread logic: determine thread_id for this message
	var threadID *string
	if d.ThreadID != nil {
		// Explicit thread_id from client (replying within thread panel)
		threadID = d.ThreadID
		h.DB.SetThreadID(msgID, *d.ThreadID)
		// Ensure the thread root also has its thread_id set
		h.DB.SetThreadID(*d.ThreadID, *d.ThreadID)
	} else if d.ReplyToID != nil {
		// Replying from main feed — create or join a thread
		parent, _ := h.DB.GetMessageByID(*d.ReplyToID)
		if parent != nil {
			if parent.ThreadID != nil {
				// Parent is already in a thread — join it
				threadID = parent.ThreadID
			} else {
				// Parent has no thread — make it a thread root
				h.DB.SetThreadID(parent.ID, parent.ID)
				tid := parent.ID
				threadID = &tid
			}
			h.DB.SetThreadID(msgID, *threadID)
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
				// Build content preview with resolved mentions
				var preview string
				if d.Content != nil {
					preview = mentionRegex.ReplaceAllStringFunc(*d.Content, func(match string) string {
						sub := mentionRegex.FindStringSubmatch(match)
						if len(sub) < 2 {
							return match
						}
						if u, err := h.DB.GetUserByID(sub[1]); err == nil {
							return "@" + u.Username
						}
						return match
					})
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
		ThreadID:    threadID,
		CreatedAt:   msg.CreatedAt,
	})
	if ch.Visibility != "public" {
		h.BroadcastToMembers(broadcast, ch.ID)
	} else {
		h.BroadcastAll(broadcast)
	}

	// Async URL unfurling
	if d.Content != nil {
		urls := unfurl.ExtractURLs(*d.Content)
		if len(urls) > 0 {
			go h.processUnfurls(msg.ID, msg.ChannelID, urls)
		}
	}

	// Notify thread participants (except sender and already-mentioned users)
	if threadID != nil {
		participants, _ := h.DB.GetThreadParticipants(*threadID)
		for _, participantID := range participants {
			if participantID == c.UserID {
				continue
			}
			alreadyNotified := false
			for _, mentionedID := range mentionIDs {
				if mentionedID == participantID {
					alreadyNotified = true
					break
				}
			}
			if alreadyNotified {
				continue
			}

			chName := ""
			if ch != nil {
				chName = ch.Name
			}
			var preview string
			if d.Content != nil {
				preview = *d.Content
				if len(preview) > 80 {
					preview = preview[:80] + "..."
				}
			}

			notifID := uuid.New().String()
			notifData := map[string]any{
				"thread_id":       *threadID,
				"channel_id":      d.ChannelID,
				"channel_name":    chName,
				"message_id":      msgID,
				"author_username": c.User.Username,
				"content_preview": preview,
			}
			if err := h.DB.CreateNotification(notifID, participantID, "thread_reply", notifData); err != nil {
				log.Printf("create thread notification: %v", err)
				continue
			}
			dataJSON, _ := json.Marshal(notifData)
			notifMsg, _ := NewMessage("notification_create", NotificationPayload{
				ID:        notifID,
				Type:      "thread_reply",
				Data:      dataJSON,
				Read:      false,
				CreatedAt: msg.CreatedAt,
			})
			h.SendTo(participantID, notifMsg)
		}
	}
}

func (h *Hub) processUnfurls(messageID, channelID string, urls []string) {
	results := unfurl.FetchUnfurls(urls)

	var payloads []UnfurlPayload
	for _, r := range results {
		status := "error"
		if r.Success {
			status = "success"
		}
		u := &db.URLUnfurl{
			ID:          uuid.New().String(),
			MessageID:   messageID,
			URL:         r.URL,
			SiteName:    r.SiteName,
			Title:       r.Title,
			Description: r.Description,
			ImageURL:    r.ImageURL,
			FetchStatus: status,
		}
		if err := h.DB.CreateURLUnfurl(u); err != nil {
			log.Printf("create unfurl: %v", err)
			continue
		}
		if r.Success {
			siteName := ""
			if r.SiteName != nil {
				siteName = *r.SiteName
			}
			payloads = append(payloads, UnfurlPayload{
				URL:         r.URL,
				SiteName:    siteName,
				Title:       r.Title,
				Description: r.Description,
			})
		}
	}

	if len(payloads) > 0 {
		msg, _ := NewMessage("message_unfurls", MessageUnfurlsPayload{
			MessageID: messageID,
			ChannelID: channelID,
			Unfurls:   payloads,
		})
		h.BroadcastAll(msg)
	}
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
		Visibility: ch.Visibility,
		Description: ch.Description,
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
		Visibility: ch.Visibility,
		Description: ch.Description,
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

// --- Feature toggle handler ---

type SetFeatureData struct {
	Feature string `json:"feature"`
	Enabled bool   `json:"enabled"`
}

func (h *Hub) handleSetFeature(c *Client, data json.RawMessage) {
	if !c.User.IsAdmin {
		return
	}

	var d SetFeatureData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if d.Feature == "" {
		return
	}

	key := "feature:" + d.Feature
	if d.Enabled {
		if err := h.DB.SetSetting(key, "1"); err != nil {
			log.Printf("set feature %s: %v", d.Feature, err)
			return
		}
	} else {
		if err := h.DB.DeleteSetting(key); err != nil {
			log.Printf("delete feature %s: %v", d.Feature, err)
			return
		}
	}

	broadcast, _ := NewMessage("feature_toggled", map[string]any{
		"feature": d.Feature,
		"enabled": d.Enabled,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleMarkRead(c *Client, data json.RawMessage) {
	var d struct {
		ChannelID string `json:"channel_id"`
		MessageID string `json:"message_id"`
	}
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}
	if d.ChannelID == "" || d.MessageID == "" {
		return
	}
	h.DB.MarkChannelRead(d.ChannelID, c.UserID, d.MessageID)
}

// Radio, Media, and Strudel handlers have been moved to applet files:
// - applet_radio.go
// - applet_media.go
// - applet_strudel.go
