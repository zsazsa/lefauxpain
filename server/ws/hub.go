package ws

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/sfu"
	"nhooyr.io/websocket"
)

type MediaPlaybackState struct {
	VideoID   string
	Playing   bool
	Position  float64 // seconds into video
	UpdatedAt float64 // unix timestamp (seconds, fractional)
}

type RadioPlaybackState struct {
	StationID  string
	PlaylistID string
	TrackIndex int
	Playing    bool
	Position   float64
	UpdatedAt  float64
	UserID     string
	Tracks     []RadioTrackPayload // cached track list for the playlist
}

type Hub struct {
	DB             *db.DB
	SFU            *sfu.SFU
	DevMode        bool
	clients        map[string]*Client // userID → client
	mu             sync.RWMutex
	register       chan *Client
	unregister     chan *Client
	broadcast      chan []byte
	mediaPlayback  *MediaPlaybackState
	mediaMu        sync.RWMutex
	radioPlayback  map[string]*RadioPlaybackState // stationID → state
	radioMu        sync.RWMutex
	radioListeners map[string]map[string]bool // stationID → set of userIDs
	radioListMu    sync.RWMutex
}

func NewHub(database *db.DB, sfuInstance *sfu.SFU, devMode bool) *Hub {
	return &Hub{
		DB:            database,
		SFU:           sfuInstance,
		DevMode:       devMode,
		clients:       make(map[string]*Client),
		register:      make(chan *Client),
		unregister:    make(chan *Client),
		broadcast:     make(chan []byte, 256),
		radioPlayback:  make(map[string]*RadioPlaybackState),
		radioListeners: make(map[string]map[string]bool),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			// Close existing connection for same user (one conn per user)
			if existing, ok := h.clients[client.UserID]; ok {
				existing.Close()
			}
			h.clients[client.UserID] = client
			h.mu.Unlock()

			// Broadcast user_online to all other clients
			msg, err := NewMessage("user_online", UserOnlineData{
				User: UserPayload{
					ID:       client.User.ID,
					Username: client.User.Username,
					IsAdmin:  client.User.IsAdmin,
				},
			})
			if err == nil {
				h.BroadcastExcept(msg, client.UserID)
			}

		case client := <-h.unregister:
			h.mu.Lock()
			// Only remove if this is still the current client for this user
			if current, ok := h.clients[client.UserID]; ok && current == client {
				delete(h.clients, client.UserID)
			}
			h.mu.Unlock()

			// Stop screen share if presenter disconnects
			// StopScreenShare triggers OnScreenShareStopped callback which broadcasts
			if h.SFU != nil {
				if sr := h.SFU.GetUserScreenRoom(client.UserID); sr != nil {
					h.SFU.StopScreenShare(sr.ChannelID)
				}
			}

			// Leave voice if in a voice channel
			if h.SFU != nil {
				if room := h.SFU.GetUserRoom(client.UserID); room != nil {
					room.RemovePeer(client.UserID)
					vsMsg, _ := NewMessage("voice_state_update", VoiceStatePayload{
						UserID:    client.UserID,
						ChannelID: "",
					})
					h.BroadcastAll(vsMsg)
				}
			}

			// Remove from radio listeners
			h.removeRadioListener(client.UserID)

			// Broadcast user_offline
			msg, err := NewMessage("user_offline", UserOfflineData{
				UserID: client.UserID,
			})
			if err == nil {
				h.BroadcastAll(msg)
			}

		case msg := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				client.Send(msg)
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) BroadcastAll(msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, client := range h.clients {
		client.Send(msg)
	}
}

func (h *Hub) BroadcastExcept(msg []byte, excludeUserID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for userID, client := range h.clients {
		if userID != excludeUserID {
			client.Send(msg)
		}
	}
}

func (h *Hub) OnlineUsers() []UserPayload {
	h.mu.RLock()
	defer h.mu.RUnlock()
	users := make([]UserPayload, 0, len(h.clients))
	for _, client := range h.clients {
		users = append(users, UserPayload{
			ID:       client.User.ID,
			Username: client.User.Username,
			IsAdmin:  client.User.IsAdmin,
		})
	}
	return users
}

func (h *Hub) SendTo(userID string, msg []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if client, ok := h.clients[userID]; ok {
		client.Send(msg)
	}
}

func (h *Hub) GetMediaPlayback() *MediaPlaybackPayload {
	h.mediaMu.RLock()
	defer h.mediaMu.RUnlock()
	if h.mediaPlayback == nil {
		return nil
	}
	return &MediaPlaybackPayload{
		VideoID:   h.mediaPlayback.VideoID,
		Playing:   h.mediaPlayback.Playing,
		Position:  h.mediaPlayback.Position,
		UpdatedAt: h.mediaPlayback.UpdatedAt,
	}
}

func (h *Hub) SetMediaPlayback(state *MediaPlaybackState) {
	h.mediaMu.Lock()
	h.mediaPlayback = state
	h.mediaMu.Unlock()
}

func (h *Hub) ClearMediaPlaybackIfVideo(videoID string) {
	h.mediaMu.Lock()
	if h.mediaPlayback != nil && h.mediaPlayback.VideoID == videoID {
		h.mediaPlayback = nil
	}
	h.mediaMu.Unlock()

	// Broadcast null playback state
	msg, _ := NewMessage("media_playback", nil)
	h.BroadcastAll(msg)
}

func (h *Hub) GetRadioPlayback(stationID string) *RadioPlaybackState {
	h.radioMu.RLock()
	defer h.radioMu.RUnlock()
	return h.radioPlayback[stationID]
}

func (h *Hub) SetRadioPlayback(stationID string, state *RadioPlaybackState) {
	h.radioMu.Lock()
	h.radioPlayback[stationID] = state
	h.radioMu.Unlock()
}

func (h *Hub) ClearRadioPlayback(stationID string) {
	h.radioMu.Lock()
	delete(h.radioPlayback, stationID)
	h.radioMu.Unlock()
}

func (h *Hub) GetAllRadioPlayback() map[string]*RadioPlaybackPayload {
	h.radioMu.RLock()
	defer h.radioMu.RUnlock()
	result := make(map[string]*RadioPlaybackPayload)
	for sid, state := range h.radioPlayback {
		var track RadioTrackPayload
		if state.TrackIndex >= 0 && state.TrackIndex < len(state.Tracks) {
			track = state.Tracks[state.TrackIndex]
		}
		result[sid] = &RadioPlaybackPayload{
			StationID:  state.StationID,
			PlaylistID: state.PlaylistID,
			TrackIndex: state.TrackIndex,
			Track:      track,
			Playing:    state.Playing,
			Position:   state.Position,
			UpdatedAt:  state.UpdatedAt,
			UserID:     state.UserID,
		}
	}
	return result
}

// ClearRadioPlaybackByPlaylist stops any station playing a given playlist.
func (h *Hub) ClearRadioPlaybackByPlaylist(playlistID string) []string {
	h.radioMu.Lock()
	var cleared []string
	for sid, state := range h.radioPlayback {
		if state.PlaylistID == playlistID {
			delete(h.radioPlayback, sid)
			cleared = append(cleared, sid)
		}
	}
	h.radioMu.Unlock()
	return cleared
}

// --- Radio listeners ---

func (h *Hub) SetRadioListener(userID, stationID string) {
	h.radioListMu.Lock()
	// Remove from any previous station
	for sid, users := range h.radioListeners {
		if users[userID] {
			delete(users, userID)
			if len(users) == 0 {
				delete(h.radioListeners, sid)
			}
		}
	}
	// Add to new station
	if stationID != "" {
		if h.radioListeners[stationID] == nil {
			h.radioListeners[stationID] = make(map[string]bool)
		}
		h.radioListeners[stationID][userID] = true
	}
	h.radioListMu.Unlock()
}

func (h *Hub) removeRadioListener(userID string) {
	h.radioListMu.Lock()
	for sid, users := range h.radioListeners {
		if users[userID] {
			delete(users, userID)
			if len(users) == 0 {
				delete(h.radioListeners, sid)
			}
			// Broadcast updated listeners for this station
			h.radioListMu.Unlock()
			h.broadcastRadioListeners(sid)
			return
		}
	}
	h.radioListMu.Unlock()
}

func (h *Hub) GetRadioListeners(stationID string) []string {
	h.radioListMu.RLock()
	defer h.radioListMu.RUnlock()
	users := h.radioListeners[stationID]
	result := make([]string, 0, len(users))
	for uid := range users {
		result = append(result, uid)
	}
	return result
}

func (h *Hub) GetAllRadioListeners() map[string][]string {
	h.radioListMu.RLock()
	defer h.radioListMu.RUnlock()
	result := make(map[string][]string)
	for sid, users := range h.radioListeners {
		list := make([]string, 0, len(users))
		for uid := range users {
			list = append(list, uid)
		}
		result[sid] = list
	}
	return result
}

// BroadcastToRadioListeners sends a message only to users tuned into the given station.
func (h *Hub) BroadcastToRadioListeners(stationID string, msg []byte) {
	listeners := h.GetRadioListeners(stationID)
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, uid := range listeners {
		if client, ok := h.clients[uid]; ok {
			client.Send(msg)
		}
	}
}

// BroadcastRadioStatus sends a lightweight status update to all connected clients
// so the sidebar shows which stations are live, without triggering audio.
func (h *Hub) BroadcastRadioStatus(stationID string, playing bool, trackName string, userID string) {
	msg, _ := NewMessage("radio_status", map[string]any{
		"station_id": stationID,
		"playing":    playing,
		"track_name": trackName,
		"user_id":    userID,
	})
	h.BroadcastAll(msg)
}

// BroadcastRadioStopped sends a stopped status to all connected clients.
func (h *Hub) BroadcastRadioStopped(stationID string) {
	msg, _ := NewMessage("radio_status", map[string]any{
		"station_id": stationID,
		"stopped":    true,
	})
	h.BroadcastAll(msg)
}

func (h *Hub) broadcastRadioListeners(stationID string) {
	listeners := h.GetRadioListeners(stationID)
	msg, _ := NewMessage("radio_listeners", map[string]any{
		"station_id": stationID,
		"user_ids":   listeners,
	})
	h.BroadcastAll(msg)
}

func nowUnix() float64 {
	return float64(time.Now().UnixMilli()) / 1000.0
}

func (h *Hub) DisconnectUser(userID string) {
	h.mu.RLock()
	client, ok := h.clients[userID]
	h.mu.RUnlock()
	if ok {
		client.Close()
	}
}

func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: h.DevMode,
	})
	if err != nil {
		log.Printf("ws accept: %v", err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	client := &Client{
		hub:    h,
		conn:   conn,
		send:   make(chan []byte, sendBufSize),
		ctx:    ctx,
		cancel: cancel,
	}

	go client.writePump()
	client.readPump() // Block until connection closes
}

func (h *Hub) HandleMessage(client *Client, msg *Message) {
	switch msg.Op {
	case "send_message":
		h.handleSendMessage(client, msg.Data)
	case "edit_message":
		h.handleEditMessage(client, msg.Data)
	case "delete_message":
		h.handleDeleteMessage(client, msg.Data)
	case "add_reaction":
		h.handleAddReaction(client, msg.Data)
	case "remove_reaction":
		h.handleRemoveReaction(client, msg.Data)
	case "typing_start":
		h.handleTypingStart(client, msg.Data)
	case "create_channel":
		h.handleCreateChannel(client, msg.Data)
	case "delete_channel":
		h.handleDeleteChannel(client, msg.Data)
	case "reorder_channels":
		h.handleReorderChannels(client, msg.Data)
	case "rename_channel":
		h.handleRenameChannel(client, msg.Data)
	case "restore_channel":
		h.handleRestoreChannel(client, msg.Data)
	case "add_channel_manager":
		h.handleAddChannelManager(client, msg.Data)
	case "remove_channel_manager":
		h.handleRemoveChannelManager(client, msg.Data)
	case "join_voice":
		h.handleJoinVoice(client, msg.Data)
	case "leave_voice":
		h.handleLeaveVoice(client)
	case "webrtc_answer":
		h.handleWebRTCAnswer(client, msg.Data)
	case "webrtc_ice":
		h.handleWebRTCICE(client, msg.Data)
	case "voice_self_mute":
		h.handleVoiceSelfMute(client, msg.Data)
	case "voice_self_deafen":
		h.handleVoiceSelfDeafen(client, msg.Data)
	case "voice_speaking":
		h.handleVoiceSpeaking(client, msg.Data)
	case "voice_server_mute":
		h.handleVoiceServerMute(client, msg.Data)
	case "screen_share_start":
		h.handleScreenShareStart(client, msg.Data)
	case "screen_share_stop":
		h.handleScreenShareStop(client)
	case "screen_share_subscribe":
		h.handleScreenShareSubscribe(client, msg.Data)
	case "screen_share_unsubscribe":
		h.handleScreenShareUnsubscribe(client, msg.Data)
	case "webrtc_screen_answer":
		h.handleWebRTCScreenAnswer(client, msg.Data)
	case "webrtc_screen_ice":
		h.handleWebRTCScreenICE(client, msg.Data)
	case "mark_notification_read":
		h.handleMarkNotificationRead(client, msg.Data)
	case "mark_all_notifications_read":
		h.handleMarkAllNotificationsRead(client)
	case "media_play":
		h.handleMediaPlay(client, msg.Data)
	case "media_pause":
		h.handleMediaPause(client, msg.Data)
	case "media_seek":
		h.handleMediaSeek(client, msg.Data)
	case "media_stop":
		h.handleMediaStop(client)
	case "create_radio_station":
		h.handleCreateRadioStation(client, msg.Data)
	case "delete_radio_station":
		h.handleDeleteRadioStation(client, msg.Data)
	case "rename_radio_station":
		h.handleRenameRadioStation(client, msg.Data)
	case "add_radio_station_manager":
		h.handleAddRadioStationManager(client, msg.Data)
	case "remove_radio_station_manager":
		h.handleRemoveRadioStationManager(client, msg.Data)
	case "create_radio_playlist":
		h.handleCreateRadioPlaylist(client, msg.Data)
	case "delete_radio_playlist":
		h.handleDeleteRadioPlaylist(client, msg.Data)
	case "reorder_radio_tracks":
		h.handleReorderRadioTracks(client, msg.Data)
	case "radio_play":
		h.handleRadioPlay(client, msg.Data)
	case "radio_pause":
		h.handleRadioPause(client, msg.Data)
	case "radio_resume":
		h.handleRadioResume(client, msg.Data)
	case "radio_seek":
		h.handleRadioSeek(client, msg.Data)
	case "radio_next":
		h.handleRadioNext(client, msg.Data)
	case "radio_stop":
		h.handleRadioStop(client, msg.Data)
	case "radio_track_ended":
		h.handleRadioTrackEnded(client, msg.Data)
	case "set_radio_station_mode":
		h.handleSetRadioStationMode(client, msg.Data)
	case "set_radio_station_public_controls":
		h.handleSetRadioStationPublicControls(client, msg.Data)
	case "radio_tune":
		h.handleRadioTune(client, msg.Data)
	case "radio_untune":
		h.handleRadioUntune(client)
	case "ping":
		pong, _ := NewMessage("pong", nil)
		client.Send(pong)
	default:
		log.Printf("unhandled op: %s from user %s", msg.Op, client.UserID)
	}
}
