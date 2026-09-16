package ws

import (
	"encoding/json"

	"github.com/kalman/voicechat/db"
)

// headless returns a connection-less Client for user. Applet handlers only
// read UserID/User from the client, so it can drive them from non-WebSocket
// entry points such as the MCP endpoint. Never register it with the hub.
func (h *Hub) headless(user *db.User) *Client {
	return &Client{hub: h, UserID: user.ID, User: user}
}

// ExecuteAs runs a WebSocket applet op on behalf of user with the same
// handler and permission checks a real socket would hit. It reports whether
// an applet claimed the op; handler outcomes are observed through state
// (e.g. RadioPlaybackSnapshot) because the handlers themselves are silent.
func (h *Hub) ExecuteAs(user *db.User, op string, data any) bool {
	raw, err := json.Marshal(data)
	if err != nil {
		return false
	}
	return h.applets.Dispatch(h, h.headless(user), op, raw)
}

// CanManageRadioStation is the exported form of the manager/admin check.
func (h *Hub) CanManageRadioStation(user *db.User, stationID string) bool {
	return h.canManageRadioStation(h.headless(user), stationID)
}

// CanControlRadioPlayback is the exported form of the playback ACL.
func (h *Hub) CanControlRadioPlayback(user *db.User, stationID string) bool {
	return h.canControlRadioPlayback(h.headless(user), stationID)
}

// RadioPlaybackSnapshot returns the current playback for a station with the
// position advanced to "now" when playing, or nil when the station is idle.
func (h *Hub) RadioPlaybackSnapshot(stationID string) *RadioPlaybackPayload {
	h.radioMu.RLock()
	defer h.radioMu.RUnlock()
	state := h.radioPlayback[stationID]
	if state == nil {
		return nil
	}
	var track RadioTrackPayload
	if state.TrackIndex >= 0 && state.TrackIndex < len(state.Tracks) {
		track = state.Tracks[state.TrackIndex]
	}
	pos := state.Position
	if state.Playing {
		pos += nowUnix() - state.UpdatedAt
		if track.Duration > 0 && pos > track.Duration {
			pos = track.Duration
		}
	}
	return &RadioPlaybackPayload{
		StationID:  state.StationID,
		PlaylistID: state.PlaylistID,
		TrackIndex: state.TrackIndex,
		Track:      track,
		Playing:    state.Playing,
		Position:   pos,
		UpdatedAt:  state.UpdatedAt,
		UserID:     state.UserID,
	}
}

// RadioTrackCount reports how many tracks the snapshot's playlist holds.
func (h *Hub) RadioTrackCount(stationID string) int {
	h.radioMu.RLock()
	defer h.radioMu.RUnlock()
	if state := h.radioPlayback[stationID]; state != nil {
		return len(state.Tracks)
	}
	return 0
}
