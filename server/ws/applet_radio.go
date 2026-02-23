package ws

import (
	"encoding/json"
	"log"
	"strings"

	"github.com/google/uuid"
)

// RadioApplet returns the applet definition for radio stations.
func RadioApplet() *AppletDef {
	return &AppletDef{
		Name: "radio",
		Handlers: map[string]AppletHandlerFunc{
			"create_radio_station": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleCreateRadioStation(c, data)
			},
			"delete_radio_station": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleDeleteRadioStation(c, data)
			},
			"rename_radio_station": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRenameRadioStation(c, data)
			},
			"add_radio_station_manager": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleAddRadioStationManager(c, data)
			},
			"remove_radio_station_manager": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRemoveRadioStationManager(c, data)
			},
			"create_radio_playlist": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleCreateRadioPlaylist(c, data)
			},
			"delete_radio_playlist": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleDeleteRadioPlaylist(c, data)
			},
			"reorder_radio_tracks": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleReorderRadioTracks(c, data)
			},
			"radio_play": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioPlay(c, data)
			},
			"radio_pause": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioPause(c, data)
			},
			"radio_resume": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioResume(c, data)
			},
			"radio_seek": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioSeek(c, data)
			},
			"radio_next": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioNext(c, data)
			},
			"radio_stop": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioStop(c, data)
			},
			"radio_track_ended": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioTrackEnded(c, data)
			},
			"set_radio_station_mode": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleSetRadioStationMode(c, data)
			},
			"set_radio_station_public_controls": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleSetRadioStationPublicControls(c, data)
			},
			"radio_tune": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioTune(c, data)
			},
			"radio_untune": func(h *Hub, c *Client, data json.RawMessage) {
				h.handleRadioUntune(c)
			},
		},
		ReadyContrib: radioReadyContrib,
		OnDisconnect: func(h *Hub, c *Client) {
			h.removeRadioListener(c.UserID)
		},
	}
}

func radioReadyContrib(h *Hub, c *Client) map[string]any {
	// Radio stations
	dbStations, _ := h.DB.GetAllRadioStations()
	allStationManagers, _ := h.DB.GetAllRadioStationManagers()
	stationPayloads := make([]RadioStationPayload, len(dbStations))
	for i, s := range dbStations {
		mgrs := allStationManagers[s.ID]
		if mgrs == nil {
			mgrs = []string{}
		}
		stationPayloads[i] = RadioStationPayload{
			ID:             s.ID,
			Name:           s.Name,
			CreatedBy:      s.CreatedBy,
			Position:       s.Position,
			PlaybackMode:   s.PlaybackMode,
			PublicControls: s.PublicControls,
			ManagerIDs:     mgrs,
		}
	}

	// Radio playback states
	radioPlayback := h.GetAllRadioPlayback()

	// Radio listeners
	radioListeners := h.GetAllRadioListeners()

	// Radio playlists with tracks
	dbPlaylists, _ := h.DB.GetAllPlaylists()
	playlistPayloads := make([]RadioPlaylistPayload, len(dbPlaylists))
	for i, p := range dbPlaylists {
		dbTracks, _ := h.DB.GetTracksByPlaylist(p.ID)
		trackPayloads := make([]RadioTrackPayload, len(dbTracks))
		for j, t := range dbTracks {
			trackPayloads[j] = RadioTrackPayload{
				ID:       t.ID,
				Filename: t.Filename,
				URL:      "/" + strings.ReplaceAll(t.Path, "\\", "/"),
				Duration: t.Duration,
				Position: t.Position,
				Waveform: t.Waveform,
			}
		}
		sid := ""
		if p.StationID != nil {
			sid = *p.StationID
		}
		playlistPayloads[i] = RadioPlaylistPayload{
			ID:        p.ID,
			Name:      p.Name,
			UserID:    p.UserID,
			StationID: sid,
			Tracks:    trackPayloads,
		}
	}

	return map[string]any{
		"radio_stations":  stationPayloads,
		"radio_playback":  radioPlayback,
		"radio_playlists": playlistPayloads,
		"radio_listeners": radioListeners,
	}
}

// --- Radio data types ---

type RadioStationManagerData struct {
	StationID string `json:"station_id"`
	UserID    string `json:"user_id"`
}

type RadioStationUpdatePayload struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	PlaybackMode   string   `json:"playback_mode"`
	PublicControls bool     `json:"public_controls"`
	ManagerIDs     []string `json:"manager_ids"`
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

type SetRadioStationModeData struct {
	StationID string `json:"station_id"`
	Mode      string `json:"mode"`
}

type SetRadioStationPublicControlsData struct {
	StationID string `json:"station_id"`
	Enabled   bool   `json:"enabled"`
}

// --- Radio handler helpers ---

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

func (h *Hub) canControlRadioPlayback(c *Client, stationID string) bool {
	return true
}

// --- Radio handlers ---

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
		ID:             station.ID,
		Name:           name,
		PlaybackMode:   station.PlaybackMode,
		PublicControls: station.PublicControls,
		ManagerIDs:     managerIDs,
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

	if !h.canControlRadioPlayback(c, d.StationID) {
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

	if !h.canControlRadioPlayback(c, d.StationID) {
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

	if !h.canControlRadioPlayback(c, d.StationID) {
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

	if !h.canControlRadioPlayback(c, d.StationID) {
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

	if !h.canControlRadioPlayback(c, d.StationID) {
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

	if !h.canControlRadioPlayback(c, d.StationID) {
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
		ID:             d.StationID,
		Name:           station.Name,
		PlaybackMode:   station.PlaybackMode,
		PublicControls: station.PublicControls,
		ManagerIDs:     managerIDs,
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
		ID:             d.StationID,
		Name:           station.Name,
		PlaybackMode:   station.PlaybackMode,
		PublicControls: station.PublicControls,
		ManagerIDs:     managerIDs,
	})
	h.BroadcastAll(broadcast)
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
		ID:             d.StationID,
		Name:           station.Name,
		PlaybackMode:   d.Mode,
		PublicControls: station.PublicControls,
		ManagerIDs:     managerIDs,
	})
	h.BroadcastAll(broadcast)
}

func (h *Hub) handleSetRadioStationPublicControls(c *Client, data json.RawMessage) {
	var d SetRadioStationPublicControlsData
	if err := json.Unmarshal(data, &d); err != nil {
		return
	}

	if !h.canManageRadioStation(c, d.StationID) {
		return
	}

	station, err := h.DB.GetRadioStationByID(d.StationID)
	if err != nil || station == nil {
		return
	}

	if err := h.DB.UpdateRadioStationPublicControls(d.StationID, d.Enabled); err != nil {
		log.Printf("update radio station public controls: %v", err)
		return
	}

	managerIDs, _ := h.DB.GetRadioStationManagers(d.StationID)
	if managerIDs == nil {
		managerIDs = []string{}
	}

	broadcast, _ := NewMessage("radio_station_update", RadioStationUpdatePayload{
		ID:             d.StationID,
		Name:           station.Name,
		PlaybackMode:   station.PlaybackMode,
		PublicControls: d.Enabled,
		ManagerIDs:     managerIDs,
	})
	h.BroadcastAll(broadcast)
}

// getNextPlaylistTracks finds the next playlist with tracks after currentPlaylistID for a station.
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
