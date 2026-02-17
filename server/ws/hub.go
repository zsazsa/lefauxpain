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
}

func NewHub(database *db.DB, sfuInstance *sfu.SFU, devMode bool) *Hub {
	return &Hub{
		DB:         database,
		SFU:        sfuInstance,
		DevMode:    devMode,
		clients:    make(map[string]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan []byte, 256),
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
	case "ping":
		pong, _ := NewMessage("pong", nil)
		client.Send(pong)
	default:
		log.Printf("unhandled op: %s from user %s", msg.Op, client.UserID)
	}
}
