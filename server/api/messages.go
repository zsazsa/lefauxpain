package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/kalman/voicechat/db"
)

type MessageHandler struct {
	DB *db.DB
}

type messageResponse struct {
	ID          string              `json:"id"`
	ChannelID   string              `json:"channel_id"`
	Author      authorPayload       `json:"author"`
	Content     *string             `json:"content"`
	ReplyTo     *replyPayload       `json:"reply_to"`
	Attachments []attachPayload     `json:"attachments"`
	Reactions   []db.ReactionGroup  `json:"reactions"`
	Mentions    []string            `json:"mentions"`
	CreatedAt   string              `json:"created_at"`
	EditedAt    *string             `json:"edited_at"`
	Deleted     bool                `json:"deleted"`
}

type authorPayload struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatar_url"`
}

type replyPayload struct {
	ID      string        `json:"id"`
	Author  authorPayload `json:"author"`
	Content *string       `json:"content"`
	Deleted bool          `json:"deleted"`
}

type attachPayload struct {
	ID       string  `json:"id"`
	Filename string  `json:"filename"`
	URL      string  `json:"url"`
	ThumbURL *string `json:"thumb_url"`
	MimeType string  `json:"mime_type"`
	Width    *int    `json:"width"`
	Height   *int    `json:"height"`
}

func (h *MessageHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Extract channel ID from path: /api/v1/channels/{id}/messages
	parts := strings.Split(r.URL.Path, "/")
	if len(parts) < 5 {
		writeError(w, http.StatusBadRequest, "invalid path")
		return
	}
	channelID := parts[4]

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	// ?around=<messageID> — fetch messages around a target
	if around := r.URL.Query().Get("around"); around != "" {
		messages, err := h.DB.GetMessagesAround(channelID, around, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal error")
			return
		}
		result := make([]messageResponse, len(messages))
		for i, m := range messages {
			attachments, _ := h.DB.GetAttachmentsByMessage(m.ID)
			attachPayloads := make([]attachPayload, len(attachments))
			for j, a := range attachments {
				ap := attachPayload{
					ID: a.ID, Filename: a.Filename,
					URL: "/" + strings.ReplaceAll(a.Path, "\\", "/"),
					MimeType: a.MimeType, Width: a.Width, Height: a.Height,
				}
				if a.ThumbPath != nil {
					t := "/" + strings.ReplaceAll(*a.ThumbPath, "\\", "/")
					ap.ThumbURL = &t
				}
				attachPayloads[j] = ap
			}
			reactions, _ := h.DB.GetReactionsByMessage(m.ID)
			mentions, _ := h.DB.GetMentionsByMessage(m.ID)
			var reply *replyPayload
			if m.ReplyToID != nil {
				rc, _ := h.DB.GetReplyContext(*m.ReplyToID)
				if rc != nil {
					rcAuthorID := ""
					if rc.AuthorID != nil {
						rcAuthorID = *rc.AuthorID
					}
					reply = &replyPayload{
						ID:      rc.ID,
						Author:  authorPayload{ID: rcAuthorID, Username: rc.AuthorUsername},
						Content: rc.Content,
						Deleted: rc.DeletedAt != nil,
					}
				}
			}
			authorID := ""
			if m.AuthorID != nil {
				authorID = *m.AuthorID
			}
			result[i] = messageResponse{
				ID: m.ID, ChannelID: m.ChannelID,
				Author:      authorPayload{ID: authorID, Username: m.AuthorUsername, AvatarURL: m.AuthorAvatarURL},
				Content:     m.Content, ReplyTo: reply,
				Attachments: attachPayloads, Reactions: reactions,
				Mentions: mentions, CreatedAt: m.CreatedAt, EditedAt: m.EditedAt,
				Deleted: m.DeletedAt != nil,
			}
		}
		writeJSON(w, http.StatusOK, result)
		return
	}

	var before *string
	if b := r.URL.Query().Get("before"); b != "" {
		before = &b
	}

	messages, err := h.DB.GetMessages(channelID, limit, before)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	result := make([]messageResponse, len(messages))
	for i, m := range messages {
		// Get attachments
		attachments, _ := h.DB.GetAttachmentsByMessage(m.ID)
		attachPayloads := make([]attachPayload, len(attachments))
		for j, a := range attachments {
			ap := attachPayload{
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
			attachPayloads[j] = ap
		}

		// Get reactions
		reactions, _ := h.DB.GetReactionsByMessage(m.ID)

		// Get mentions
		mentions, _ := h.DB.GetMentionsByMessage(m.ID)

		// Get reply context
		var reply *replyPayload
		if m.ReplyToID != nil {
			rc, _ := h.DB.GetReplyContext(*m.ReplyToID)
			if rc != nil {
				rcAuthorID := ""
				if rc.AuthorID != nil {
					rcAuthorID = *rc.AuthorID
				}
				reply = &replyPayload{
					ID: rc.ID,
					Author: authorPayload{
						ID:       rcAuthorID,
						Username: rc.AuthorUsername,
					},
					Content: rc.Content,
					Deleted: rc.DeletedAt != nil,
				}
			}
		}

		authorID := ""
		if m.AuthorID != nil {
			authorID = *m.AuthorID
		}
		result[i] = messageResponse{
			ID:        m.ID,
			ChannelID: m.ChannelID,
			Author: authorPayload{
				ID:        authorID,
				Username:  m.AuthorUsername,
				AvatarURL: m.AuthorAvatarURL,
			},
			Content:     m.Content,
			ReplyTo:     reply,
			Attachments: attachPayloads,
			Reactions:   reactions,
			Mentions:    mentions,
			CreatedAt:   m.CreatedAt,
			EditedAt:    m.EditedAt,
			Deleted:     m.DeletedAt != nil,
		}
	}

	writeJSON(w, http.StatusOK, result)
}
