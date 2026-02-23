package ws

import (
	"encoding/json"
	"log"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
)

// StrudelApplet returns the applet definition for live coding patterns.
func StrudelApplet() *AppletDef {
	return &AppletDef{
		Name:       "strudel",
		SettingKey: "feature:strudel",
		Handlers: map[string]AppletHandlerFunc{
			"create_strudel_pattern": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleCreateStrudelPattern(c, data)
			},
			"update_strudel_pattern": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleUpdateStrudelPattern(c, data)
			},
			"delete_strudel_pattern": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleDeleteStrudelPattern(c, data)
			},
			"strudel_open": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleStrudelOpen(c, data)
			},
			"strudel_close": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleStrudelClose(c)
			},
			"strudel_play": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleStrudelPlay(c, data)
			},
			"strudel_stop": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleStrudelStop(c, data)
			},
			"strudel_code_edit": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleStrudelCodeEdit(c, data)
			},
		},
		ReadyContrib: strudelReadyContrib,
		OnDisconnect: func(h *Hub, c *Client) {
			h.removeStrudelViewer(c.UserID)
		},
	}
}

func strudelReadyContrib(h *Hub, c *Client) map[string]any {
	dbPatterns, _ := h.DB.ListStrudelPatterns(c.UserID)
	patternPayloads := make([]StrudelPatternPayload, len(dbPatterns))
	for i, p := range dbPatterns {
		patternPayloads[i] = StrudelPatternPayload{
			ID:         p.ID,
			Name:       p.Name,
			Code:       p.Code,
			OwnerID:    p.OwnerID,
			Visibility: p.Visibility,
		}
	}

	return map[string]any{
		"strudel_patterns": patternPayloads,
		"strudel_playback": h.GetAllStrudelPlayback(),
		"strudel_viewers":  h.GetAllStrudelViewers(),
	}
}

// --- Strudel data types ---

type CreateStrudelPatternData struct {
	Name string `json:"name"`
}

type UpdateStrudelPatternData struct {
	PatternID  string  `json:"pattern_id"`
	Name       *string `json:"name"`
	Code       *string `json:"code"`
	Visibility *string `json:"visibility"`
}

type DeleteStrudelPatternData struct {
	PatternID string `json:"pattern_id"`
}

type StrudelOpenData struct {
	PatternID string `json:"pattern_id"`
}

type StrudelPlayData struct {
	PatternID string   `json:"pattern_id"`
	CPS       *float64 `json:"cps"`
}

type StrudelStopData struct {
	PatternID string `json:"pattern_id"`
}

type StrudelCodeEditData struct {
	PatternID string `json:"pattern_id"`
	Code      string `json:"code"`
}

// --- Strudel handler helpers ---

func (h *Hub) isStrudelEnabled() bool {
	v, _ := h.DB.GetSetting("feature:strudel")
	return v == "1"
}

func (h *Hub) canAccessStrudelPattern(c *Client, pattern *db.StrudelPattern) bool {
	if pattern == nil {
		return false
	}
	if pattern.OwnerID == c.UserID {
		return true
	}
	return pattern.Visibility != "private"
}

func (h *Hub) canEditStrudelCode(c *Client, pattern *db.StrudelPattern) bool {
	if pattern == nil {
		return false
	}
	if pattern.OwnerID == c.UserID {
		return true
	}
	return pattern.Visibility == "open"
}

// --- Strudel handlers ---

func (h *Hub) handleCreateStrudelPattern(c *Client, data json.RawMessage) {
	if !h.isStrudelEnabled() {
		return
	}

	var d CreateStrudelPatternData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	name := strings.TrimSpace(d.Name)
	if name == "" || len(name) > 64 {
		return
	}

	patternID := uuid.New().String()
	pattern, err := h.DB.CreateStrudelPattern(patternID, name, c.UserID)
	if err != nil {
		log.Printf("create strudel pattern: %v", err)
		return
	}

	broadcast, _ := NewMessage("strudel_pattern_created", StrudelPatternPayload{
		ID:         pattern.ID,
		Name:       pattern.Name,
		Code:       pattern.Code,
		OwnerID:    pattern.OwnerID,
		Visibility: pattern.Visibility,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleUpdateStrudelPattern(c *Client, data json.RawMessage) {
	if !h.isStrudelEnabled() {
		return
	}

	var d UpdateStrudelPatternData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	pattern, err := h.DB.GetStrudelPattern(d.PatternID)
	if err != nil || pattern == nil {
		return
	}

	// Validate name/visibility changes: owner only
	if d.Name != nil || d.Visibility != nil {
		if pattern.OwnerID != c.UserID {
			return
		}
	}

	// Validate code changes: owner or open
	if d.Code != nil {
		if !h.canEditStrudelCode(c, pattern) {
			return
		}
	}

	// Validate visibility value
	if d.Visibility != nil {
		switch *d.Visibility {
		case "private", "public", "open":
		default:
			return
		}
	}

	// Validate name length
	if d.Name != nil {
		name := strings.TrimSpace(*d.Name)
		if name == "" || len(name) > 64 {
			return
		}
		d.Name = &name
	}

	if err := h.DB.UpdateStrudelPattern(d.PatternID, d.Name, d.Code, d.Visibility); err != nil {
		log.Printf("update strudel pattern: %v", err)
		return
	}

	payload := map[string]any{"id": d.PatternID}
	if d.Name != nil {
		payload["name"] = *d.Name
	}
	if d.Code != nil {
		payload["code"] = *d.Code
	}
	if d.Visibility != nil {
		payload["visibility"] = *d.Visibility
	}

	broadcast, _ := NewMessage("strudel_pattern_updated", payload)
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleDeleteStrudelPattern(c *Client, data json.RawMessage) {
	if !h.isStrudelEnabled() {
		return
	}

	var d DeleteStrudelPatternData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	pattern, err := h.DB.GetStrudelPattern(d.PatternID)
	if err != nil || pattern == nil {
		return
	}

	// Owner or admin can delete
	if pattern.OwnerID != c.UserID && !c.User.IsAdmin {
		return
	}

	// Clear playback if active
	h.ClearStrudelPlayback(d.PatternID)

	if err := h.DB.DeleteStrudelPattern(d.PatternID); err != nil {
		log.Printf("delete strudel pattern: %v", err)
		return
	}

	broadcast, _ := NewMessage("strudel_pattern_deleted", map[string]string{
		"pattern_id": d.PatternID,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleStrudelOpen(c *Client, data json.RawMessage) {
	if !h.isStrudelEnabled() {
		return
	}

	var d StrudelOpenData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	pattern, err := h.DB.GetStrudelPattern(d.PatternID)
	if err != nil || pattern == nil {
		return
	}

	if !h.canAccessStrudelPattern(c, pattern) {
		return
	}

	h.SetStrudelViewer(c.UserID, d.PatternID)
	h.broadcastStrudelViewers(d.PatternID)
}

func (h *Hub) handleStrudelClose(c *Client) {
	h.removeStrudelViewer(c.UserID)
}

func (h *Hub) handleStrudelPlay(c *Client, data json.RawMessage) {
	if !h.isStrudelEnabled() {
		return
	}

	var d StrudelPlayData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	pattern, err := h.DB.GetStrudelPattern(d.PatternID)
	if err != nil || pattern == nil {
		return
	}

	if !h.canAccessStrudelPattern(c, pattern) {
		return
	}

	cps := 0.5
	if d.CPS != nil && *d.CPS > 0 && *d.CPS <= 10 {
		cps = *d.CPS
	}

	state := &StrudelPlaybackState{
		PatternID: d.PatternID,
		Code:      pattern.Code,
		Playing:   true,
		StartedAt: nowUnix(),
		CPS:       cps,
		UserID:    c.UserID,
	}
	h.SetStrudelPlayback(d.PatternID, state)

	msg, _ := NewMessage("strudel_playback", &StrudelPlaybackPayload{
		PatternID: d.PatternID,
		Code:      pattern.Code,
		Playing:   true,
		StartedAt: state.StartedAt,
		CPS:       cps,
		UserID:    c.UserID,
	})
	h.BroadcastToStrudelViewers(d.PatternID, msg)
}

func (h *Hub) handleStrudelStop(c *Client, data json.RawMessage) {
	if !h.isStrudelEnabled() {
		return
	}

	var d StrudelStopData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	state := h.GetStrudelPlayback(d.PatternID)
	if state == nil {
		return
	}

	h.ClearStrudelPlayback(d.PatternID)

	msg, _ := NewMessage("strudel_playback", map[string]any{
		"pattern_id": d.PatternID,
		"stopped":    true,
	})
	h.BroadcastToStrudelViewers(d.PatternID, msg)
}

func (h *Hub) handleStrudelCodeEdit(c *Client, data json.RawMessage) {
	if !h.isStrudelEnabled() {
		return
	}

	var d StrudelCodeEditData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	pattern, err := h.DB.GetStrudelPattern(d.PatternID)
	if err != nil || pattern == nil {
		return
	}

	if !h.canEditStrudelCode(c, pattern) {
		return
	}

	// Persist code to DB
	code := d.Code
	if err := h.DB.UpdateStrudelPattern(d.PatternID, nil, &code, nil); err != nil {
		log.Printf("update strudel code: %v", err)
		return
	}

	// Update playback state code if playing
	if state := h.GetStrudelPlayback(d.PatternID); state != nil {
		h.strudelMu.Lock()
		state.Code = code
		h.strudelMu.Unlock()
	}

	// Broadcast to other viewers (not sender)
	msg, _ := NewMessage("strudel_code_sync", map[string]any{
		"pattern_id": d.PatternID,
		"code":       code,
		"user_id":    c.UserID,
	})
	viewers := h.GetStrudelViewers(d.PatternID)
	h.mu.RLock()
	for _, uid := range viewers {
		if uid != c.UserID {
			if client, ok := h.clients[uid]; ok {
				client.Send(msg)
			}
		}
	}
	h.mu.RUnlock()
}
