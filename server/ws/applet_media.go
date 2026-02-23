package ws

import (
	"encoding/json"
	"strings"
)

// MediaApplet returns the applet definition for media library.
func MediaApplet() *AppletDef {
	return &AppletDef{
		Name: "media",
		Handlers: map[string]AppletHandlerFunc{
			"media_play": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleMediaPlay(c, data)
			},
			"media_pause": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleMediaPause(c, data)
			},
			"media_seek": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleMediaSeek(c, data)
			},
			"media_stop": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleMediaStop(c)
			},
		},
		ReadyContrib: mediaReadyContrib,
	}
}

func mediaReadyContrib(h *Hub, c *Client) map[string]any {
	dbMedia, _ := h.DB.GetAllMedia()
	mediaPayloads := make([]MediaItemPayload, len(dbMedia))
	for i, m := range dbMedia {
		mediaPayloads[i] = MediaItemPayload{
			ID:        m.ID,
			Filename:  m.Filename,
			URL:       "/" + strings.ReplaceAll(m.Path, "\\", "/"),
			MimeType:  m.MimeType,
			SizeBytes: m.SizeBytes,
			CreatedAt: m.CreatedAt,
		}
	}

	return map[string]any{
		"media_list":     mediaPayloads,
		"media_playback": h.GetMediaPlayback(),
	}
}

// --- Media data types ---

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

// --- Media handlers ---

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
