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
				if err := h.DB.CreateNotification(notifID, mentionedID, msgID, d.ChannelID, c.UserID); err != nil {
					log.Printf("create notification: %v", err)
					continue
				}
				// Get channel name for the payload
				chName := ""
				if ch != nil {
					chName = ch.Name
				}
				// Build content preview
				var preview *string
				if d.Content != nil {
					p := *d.Content
					if len(p) > 80 {
						p = p[:80] + "..."
					}
					preview = &p
				}
				notifMsg, _ := NewMessage("notification_create", NotificationPayload{
					ID:        notifID,
					MessageID: msgID,
					ChannelID: d.ChannelID,
					ChannelName: chName,
					Author: UserPayload{
						ID:       c.User.ID,
						Username: c.User.Username,
					},
					ContentPreview: preview,
					Read:           false,
					CreatedAt:      msg.CreatedAt,
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
	if err != nil || msg == nil {
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
	if msg == nil {
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
	ch, err := h.DB.CreateChannel(chID, d.Name, d.Type)
	if err != nil {
		log.Printf("create channel: %v", err)
		return
	}

	broadcast, _ := NewMessage("channel_create", ChannelPayload{
		ID:       ch.ID,
		Name:     ch.Name,
		Type:     ch.Type,
		Position: ch.Position,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleDeleteChannel(c *Client, data json.RawMessage) {
	var d DeleteChannelData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !c.User.IsAdmin {
		return
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

func (h *Hub) handleReorderChannels(c *Client, data json.RawMessage) {
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
	h.SetMediaPlayback(nil)

	msg, _ := NewMessage("media_playback", nil)
	h.BroadcastAll(msg)
}
