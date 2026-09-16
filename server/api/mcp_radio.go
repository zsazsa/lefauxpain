package api

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/ws"
)

// Radio tools for the MCP endpoint. They drive the same applet handlers the
// web client uses (via Hub.ExecuteAs), so permissions and broadcasts are
// identical; the tool layer adds argument validation and reads state back
// because the handlers report nothing themselves.

func init() {
	mcpTools = append(mcpTools, radioTools...)
}

const (
	radioModeHelp = "play_all (stop after the last playlist), loop_one (repeat the current playlist), loop_all (cycle every playlist), single (stop after the current playlist)"
)

type radioTrackView struct {
	ID       string  `json:"id"`
	Filename string  `json:"filename"`
	Duration float64 `json:"duration_seconds"`
	Position int     `json:"position"`
}

type radioPlaylistView struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	OwnerID    string           `json:"owner_id"`
	TrackCount int              `json:"track_count"`
	Tracks     []radioTrackView `json:"tracks,omitempty"`
}

type radioPlaybackView struct {
	Playing     bool    `json:"playing"`
	PlaylistID  string  `json:"playlist_id"`
	TrackIndex  int     `json:"track_index"`
	TrackCount  int     `json:"track_count"`
	TrackID     string  `json:"track_id"`
	Track       string  `json:"track"`
	Position    float64 `json:"position_seconds"`
	Duration    float64 `json:"duration_seconds"`
	StartedByID string  `json:"started_by_id"`
}

type radioStationView struct {
	ID             string              `json:"id"`
	Name           string              `json:"name"`
	PlaybackMode   string              `json:"playback_mode"`
	PublicControls bool                `json:"public_controls"`
	Managers       []string            `json:"managers"`
	YouCanManage   bool                `json:"you_can_manage"`
	YouCanControl  bool                `json:"you_can_control"`
	Listeners      int                 `json:"listeners"`
	Playback       *radioPlaybackView  `json:"playback"`
	Playlists      []radioPlaylistView `json:"playlists,omitempty"`
}

func (h *MCPHandler) playbackView(stationID string) *radioPlaybackView {
	snap := h.Hub.RadioPlaybackSnapshot(stationID)
	if snap == nil {
		return nil
	}
	return &radioPlaybackView{
		Playing:     snap.Playing,
		PlaylistID:  snap.PlaylistID,
		TrackIndex:  snap.TrackIndex,
		TrackCount:  h.Hub.RadioTrackCount(stationID),
		TrackID:     snap.Track.ID,
		Track:       snap.Track.Filename,
		Position:    snap.Position,
		Duration:    snap.Track.Duration,
		StartedByID: snap.UserID,
	}
}

func (h *MCPHandler) usernames(ids []string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if u, err := h.DB.GetUserByID(id); err == nil && u != nil {
			out = append(out, u.Username)
		} else {
			out = append(out, id)
		}
	}
	return out
}

func (h *MCPHandler) stationView(user *db.User, s *db.RadioStation, withPlaylists bool) radioStationView {
	managers, _ := h.DB.GetRadioStationManagers(s.ID)
	v := radioStationView{
		ID:             s.ID,
		Name:           s.Name,
		PlaybackMode:   s.PlaybackMode,
		PublicControls: s.PublicControls,
		Managers:       h.usernames(managers),
		YouCanManage:   h.Hub.CanManageRadioStation(user, s.ID),
		YouCanControl:  h.Hub.CanControlRadioPlayback(user, s.ID),
		Listeners:      len(h.Hub.GetRadioListeners(s.ID)),
		Playback:       h.playbackView(s.ID),
	}
	if withPlaylists {
		pls, _ := h.DB.GetPlaylistsByStation(s.ID)
		for _, p := range pls {
			tracks, _ := h.DB.GetTracksByPlaylist(p.ID)
			pv := radioPlaylistView{ID: p.ID, Name: p.Name, OwnerID: p.UserID, TrackCount: len(tracks)}
			for _, t := range tracks {
				pv.Tracks = append(pv.Tracks, radioTrackView{ID: t.ID, Filename: t.Filename, Duration: t.Duration, Position: t.Position})
			}
			v.Playlists = append(v.Playlists, pv)
		}
		if v.Playlists == nil {
			v.Playlists = []radioPlaylistView{}
		}
	}
	return v
}

// resolveStation accepts a station id or a case-insensitive name.
func (h *MCPHandler) resolveStation(ref string) (*db.RadioStation, string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, "station is required"
	}
	if _, err := uuid.Parse(ref); err == nil {
		s, err := h.DB.GetRadioStationByID(ref)
		if err != nil || s == nil {
			return nil, "station not found"
		}
		return s, ""
	}
	stations, err := h.DB.GetAllRadioStations()
	if err != nil {
		return nil, "internal error"
	}
	for i := range stations {
		if strings.EqualFold(stations[i].Name, ref) {
			return &stations[i], ""
		}
	}
	return nil, "station not found"
}

// resolvePlaylist accepts a playlist id or a case-insensitive name within the station.
func (h *MCPHandler) resolvePlaylist(stationID, ref string) (*db.RadioPlaylist, string) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, "playlist is required"
	}
	if _, err := uuid.Parse(ref); err == nil {
		p, err := h.DB.GetPlaylistByID(ref)
		if err != nil || p == nil || p.StationID == nil || *p.StationID != stationID {
			return nil, "playlist not found on this station"
		}
		return p, ""
	}
	pls, err := h.DB.GetPlaylistsByStation(stationID)
	if err != nil {
		return nil, "internal error"
	}
	for i := range pls {
		if strings.EqualFold(pls[i].Name, ref) {
			return &pls[i], ""
		}
	}
	return nil, "playlist not found on this station"
}

func (h *MCPHandler) requireControl(user *db.User, s *db.RadioStation) string {
	if h.Hub.CanControlRadioPlayback(user, s.ID) {
		return ""
	}
	return fmt.Sprintf("you cannot control %q: you are not a manager and public controls are off", s.Name)
}

func (h *MCPHandler) requireManage(user *db.User, s *db.RadioStation) string {
	if h.Hub.CanManageRadioStation(user, s.ID) {
		return ""
	}
	return fmt.Sprintf("you are not a manager of %q", s.Name)
}

// controlResult reports playback after a control op, or "stopped".
func (h *MCPHandler) controlResult(action string, s *db.RadioStation) string {
	pv := h.playbackView(s.ID)
	if pv == nil {
		return toolText(map[string]any{"station": s.Name, "station_id": s.ID, "action": action, "playback": "stopped"})
	}
	return toolText(map[string]any{"station": s.Name, "station_id": s.ID, "action": action, "playback": pv})
}

type stationArg struct {
	Station string `json:"station"`
}

func (h *MCPHandler) stationFromArgs(args json.RawMessage) (*db.RadioStation, string) {
	var a stationArg
	if err := json.Unmarshal(args, &a); err != nil {
		return nil, "invalid arguments"
	}
	return h.resolveStation(a.Station)
}

var radioTools = []mcpTool{
	{
		Name:        "list_stations",
		Description: "List radio stations with playback mode, managers, whether you can control them, listener count and what is playing now.",
		InputSchema: schema(map[string]any{}),
		run: func(h *MCPHandler, user *db.User, _ json.RawMessage) (string, bool) {
			stations, err := h.DB.GetAllRadioStations()
			if err != nil {
				return "internal error", true
			}
			out := []radioStationView{}
			for i := range stations {
				out = append(out, h.stationView(user, &stations[i], false))
			}
			return toolText(out), false
		},
	},
	{
		Name:        "station_status",
		Description: "Full status of one station: current playback with live position, and every playlist with its tracks.",
		InputSchema: schema(map[string]any{
			"station": map[string]any{"type": "string", "description": "Station name or id"},
		}, "station"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			s, msg := h.stationFromArgs(args)
			if s == nil {
				return msg, true
			}
			return toolText(h.stationView(user, s, true)), false
		},
	},
	{
		Name:        "create_station",
		Description: "Create a new radio station. You become its manager.",
		InputSchema: schema(map[string]any{
			"name": map[string]any{"type": "string", "minLength": 1, "maxLength": 32},
		}, "name"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Name string `json:"name"`
			}
			if err := json.Unmarshal(args, &a); err != nil {
				return "invalid arguments", true
			}
			name := strings.TrimSpace(a.Name)
			if name == "" || len(name) > 32 {
				return "name must be 1-32 characters", true
			}
			if existing, _ := h.resolveStation(name); existing != nil {
				return fmt.Sprintf("a station named %q already exists (id %s)", existing.Name, existing.ID), true
			}
			h.Hub.ExecuteAs(user, "create_radio_station", map[string]any{"name": name})
			s, msg := h.resolveStation(name)
			if s == nil {
				return "failed to create station: " + msg, true
			}
			return toolText(h.stationView(user, s, false)), false
		},
	},
	{
		Name:        "create_playlist",
		Description: "Create an empty playlist on a station. Tracks are added by uploading audio in the web app; MCP cannot upload files.",
		InputSchema: schema(map[string]any{
			"station": map[string]any{"type": "string"},
			"name":    map[string]any{"type": "string", "minLength": 1, "maxLength": 64},
		}, "station", "name"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Station string `json:"station"`
				Name    string `json:"name"`
			}
			if err := json.Unmarshal(args, &a); err != nil {
				return "invalid arguments", true
			}
			s, msg := h.resolveStation(a.Station)
			if s == nil {
				return msg, true
			}
			name := strings.TrimSpace(a.Name)
			if name == "" || len(name) > 64 {
				return "name must be 1-64 characters", true
			}
			h.Hub.ExecuteAs(user, "create_radio_playlist", map[string]any{"name": name, "station_id": s.ID})
			p, msg := h.resolvePlaylist(s.ID, name)
			if p == nil {
				return "failed to create playlist: " + msg, true
			}
			return toolText(map[string]any{"id": p.ID, "name": p.Name, "station": s.Name, "station_id": s.ID, "tracks": 0}), false
		},
	},
	{
		Name:        "radio_play",
		Description: "Start a station. With `playlist` (name or id) it plays that playlist from the top; without it, resumes if paused, otherwise plays the first playlist that has tracks.",
		InputSchema: schema(map[string]any{
			"station":  map[string]any{"type": "string"},
			"playlist": map[string]any{"type": "string", "description": "Optional playlist name or id"},
		}, "station"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Station  string `json:"station"`
				Playlist string `json:"playlist"`
			}
			if err := json.Unmarshal(args, &a); err != nil {
				return "invalid arguments", true
			}
			s, msg := h.resolveStation(a.Station)
			if s == nil {
				return msg, true
			}
			if msg := h.requireControl(user, s); msg != "" {
				return msg, true
			}

			if strings.TrimSpace(a.Playlist) == "" {
				if snap := h.Hub.RadioPlaybackSnapshot(s.ID); snap != nil {
					if snap.Playing {
						return h.controlResult("already_playing", s), false
					}
					h.Hub.ExecuteAs(user, "radio_resume", map[string]any{"station_id": s.ID})
					return h.controlResult("resumed", s), false
				}
				pls, _ := h.DB.GetPlaylistsByStation(s.ID)
				for i := range pls {
					if tracks, _ := h.DB.GetTracksByPlaylist(pls[i].ID); len(tracks) > 0 {
						a.Playlist = pls[i].ID
						break
					}
				}
				if a.Playlist == "" {
					return fmt.Sprintf("%q has no playlist with tracks; upload audio in the web app first", s.Name), true
				}
			}

			p, msg := h.resolvePlaylist(s.ID, a.Playlist)
			if p == nil {
				return msg, true
			}
			if tracks, _ := h.DB.GetTracksByPlaylist(p.ID); len(tracks) == 0 {
				return fmt.Sprintf("playlist %q has no tracks", p.Name), true
			}
			h.Hub.ExecuteAs(user, "radio_play", map[string]any{"station_id": s.ID, "playlist_id": p.ID})
			if h.Hub.RadioPlaybackSnapshot(s.ID) == nil {
				return "playback did not start", true
			}
			return h.controlResult("playing", s), false
		},
	},
	{
		Name:        "radio_pause",
		Description: "Pause a station at its current position.",
		InputSchema: schema(map[string]any{"station": map[string]any{"type": "string"}}, "station"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			s, msg := h.stationFromArgs(args)
			if s == nil {
				return msg, true
			}
			if msg := h.requireControl(user, s); msg != "" {
				return msg, true
			}
			snap := h.Hub.RadioPlaybackSnapshot(s.ID)
			if snap == nil {
				return "nothing is playing on this station", true
			}
			if !snap.Playing {
				return h.controlResult("already_paused", s), false
			}
			h.Hub.ExecuteAs(user, "radio_pause", map[string]any{"station_id": s.ID, "position": snap.Position})
			return h.controlResult("paused", s), false
		},
	},
	{
		Name:        "radio_resume",
		Description: "Resume a paused station.",
		InputSchema: schema(map[string]any{"station": map[string]any{"type": "string"}}, "station"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			s, msg := h.stationFromArgs(args)
			if s == nil {
				return msg, true
			}
			if msg := h.requireControl(user, s); msg != "" {
				return msg, true
			}
			snap := h.Hub.RadioPlaybackSnapshot(s.ID)
			if snap == nil {
				return "nothing is loaded on this station; use radio_play", true
			}
			if snap.Playing {
				return h.controlResult("already_playing", s), false
			}
			h.Hub.ExecuteAs(user, "radio_resume", map[string]any{"station_id": s.ID})
			return h.controlResult("resumed", s), false
		},
	},
	{
		Name:        "radio_next",
		Description: "Skip to the next track. At the end of a playlist the station's playback mode decides what happens.",
		InputSchema: schema(map[string]any{"station": map[string]any{"type": "string"}}, "station"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			s, msg := h.stationFromArgs(args)
			if s == nil {
				return msg, true
			}
			if msg := h.requireControl(user, s); msg != "" {
				return msg, true
			}
			if h.Hub.RadioPlaybackSnapshot(s.ID) == nil {
				return "nothing is playing on this station", true
			}
			h.Hub.ExecuteAs(user, "radio_next", map[string]any{"station_id": s.ID})
			return h.controlResult("skipped", s), false
		},
	},
	{
		Name:        "radio_seek",
		Description: "Seek within the current track.",
		InputSchema: schema(map[string]any{
			"station":  map[string]any{"type": "string"},
			"position": map[string]any{"type": "number", "minimum": 0, "description": "Seconds from the start of the track"},
		}, "station", "position"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Station  string   `json:"station"`
				Position *float64 `json:"position"`
			}
			if err := json.Unmarshal(args, &a); err != nil || a.Position == nil || *a.Position < 0 {
				return "station and a non-negative position are required", true
			}
			s, msg := h.resolveStation(a.Station)
			if s == nil {
				return msg, true
			}
			if msg := h.requireControl(user, s); msg != "" {
				return msg, true
			}
			snap := h.Hub.RadioPlaybackSnapshot(s.ID)
			if snap == nil {
				return "nothing is playing on this station", true
			}
			pos := *a.Position
			if snap.Track.Duration > 0 && pos > snap.Track.Duration {
				pos = snap.Track.Duration
			}
			h.Hub.ExecuteAs(user, "radio_seek", map[string]any{"station_id": s.ID, "position": pos})
			return h.controlResult("seeked", s), false
		},
	},
	{
		Name:        "radio_stop",
		Description: "Stop a station entirely (listeners hear silence until it is started again).",
		InputSchema: schema(map[string]any{"station": map[string]any{"type": "string"}}, "station"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			s, msg := h.stationFromArgs(args)
			if s == nil {
				return msg, true
			}
			if msg := h.requireControl(user, s); msg != "" {
				return msg, true
			}
			if h.Hub.RadioPlaybackSnapshot(s.ID) == nil {
				return h.controlResult("already_stopped", s), false
			}
			h.Hub.ExecuteAs(user, "radio_stop", map[string]any{"station_id": s.ID})
			return h.controlResult("stopped", s), false
		},
	},
	{
		Name:        "set_station_mode",
		Description: "Set what happens when a playlist ends: " + radioModeHelp + ". Managers only.",
		InputSchema: schema(map[string]any{
			"station": map[string]any{"type": "string"},
			"mode":    map[string]any{"type": "string", "enum": []string{"play_all", "loop_one", "loop_all", "single"}},
		}, "station", "mode"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Station string `json:"station"`
				Mode    string `json:"mode"`
			}
			if err := json.Unmarshal(args, &a); err != nil {
				return "invalid arguments", true
			}
			switch a.Mode {
			case "play_all", "loop_one", "loop_all", "single":
			default:
				return "mode must be one of: " + radioModeHelp, true
			}
			s, msg := h.resolveStation(a.Station)
			if s == nil {
				return msg, true
			}
			if msg := h.requireManage(user, s); msg != "" {
				return msg, true
			}
			h.Hub.ExecuteAs(user, "set_radio_station_mode", map[string]any{"station_id": s.ID, "mode": a.Mode})
			s, _ = h.DB.GetRadioStationByID(s.ID)
			return toolText(h.stationView(user, s, false)), false
		},
	},
	{
		Name:        "set_public_controls",
		Description: "Allow (true) or restrict (false) playback control to everyone rather than just managers. Managers only.",
		InputSchema: schema(map[string]any{
			"station": map[string]any{"type": "string"},
			"enabled": map[string]any{"type": "boolean"},
		}, "station", "enabled"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Station string `json:"station"`
				Enabled *bool  `json:"enabled"`
			}
			if err := json.Unmarshal(args, &a); err != nil || a.Enabled == nil {
				return "station and enabled are required", true
			}
			s, msg := h.resolveStation(a.Station)
			if s == nil {
				return msg, true
			}
			if msg := h.requireManage(user, s); msg != "" {
				return msg, true
			}
			h.Hub.ExecuteAs(user, "set_radio_station_public_controls", map[string]any{"station_id": s.ID, "enabled": *a.Enabled})
			s, _ = h.DB.GetRadioStationByID(s.ID)
			return toolText(h.stationView(user, s, false)), false
		},
	},
	{
		Name:        "reorder_tracks",
		Description: "Reorder a playlist you own. Pass every track id in the playlist in the new order.",
		InputSchema: schema(map[string]any{
			"station":   map[string]any{"type": "string"},
			"playlist":  map[string]any{"type": "string", "description": "Playlist name or id"},
			"track_ids": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "minItems": 1},
		}, "station", "playlist", "track_ids"),
		run: func(h *MCPHandler, user *db.User, args json.RawMessage) (string, bool) {
			var a struct {
				Station  string   `json:"station"`
				Playlist string   `json:"playlist"`
				TrackIDs []string `json:"track_ids"`
			}
			if err := json.Unmarshal(args, &a); err != nil || len(a.TrackIDs) == 0 {
				return "station, playlist and track_ids are required", true
			}
			s, msg := h.resolveStation(a.Station)
			if s == nil {
				return msg, true
			}
			p, msg := h.resolvePlaylist(s.ID, a.Playlist)
			if p == nil {
				return msg, true
			}
			if p.UserID != user.ID && !user.IsAdmin {
				return "you can only reorder playlists you own", true
			}
			tracks, _ := h.DB.GetTracksByPlaylist(p.ID)
			if len(tracks) != len(a.TrackIDs) {
				return fmt.Sprintf("track_ids must list all %d tracks exactly once", len(tracks)), true
			}
			have := map[string]bool{}
			for _, t := range tracks {
				have[t.ID] = true
			}
			seen := map[string]bool{}
			for _, id := range a.TrackIDs {
				if !have[id] || seen[id] {
					return "track_ids must list all tracks in the playlist exactly once", true
				}
				seen[id] = true
			}
			h.Hub.ExecuteAs(user, "reorder_radio_tracks", map[string]any{"playlist_id": p.ID, "track_ids": a.TrackIDs})
			tracks, _ = h.DB.GetTracksByPlaylist(p.ID)
			out := []radioTrackView{}
			for _, t := range tracks {
				out = append(out, radioTrackView{ID: t.ID, Filename: t.Filename, Duration: t.Duration, Position: t.Position})
			}
			return toolText(map[string]any{"playlist": p.Name, "playlist_id": p.ID, "tracks": out}), false
		},
	},
}

// Keep the ws import used even if payload views change.
var _ = ws.RadioPlaybackPayload{}
