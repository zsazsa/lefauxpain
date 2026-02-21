package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/kalman/voicechat/db"
	"github.com/kalman/voicechat/sfu"
	"nhooyr.io/websocket"
)

const (
	authTimeout  = 5 * time.Second
	pingInterval = 30 * time.Second
	sendBufSize  = 256
)

type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	ctx    context.Context
	cancel context.CancelFunc

	UserID string
	User   *db.User
}

func (c *Client) readPump() {
	defer func() {
		if c.User != nil {
			c.hub.unregister <- c
		}
		c.Close()
	}()

	// First message must be authenticate within timeout
	user, err := c.authenticate()
	if err != nil {
		log.Printf("ws auth failed: %v", err)
		return
	}

	c.UserID = user.ID
	c.User = user

	// Send ready event
	if err := c.sendReady(); err != nil {
		log.Printf("ws send ready: %v", err)
		return
	}

	// Register with hub
	c.hub.register <- c

	// Message loop with per-user rate limiting (30 msgs/sec)
	const wsRateLimit = 30
	const wsRateWindow = time.Second
	msgCount := 0
	windowStart := time.Now()

	for {
		_, data, err := c.conn.Read(c.ctx)
		if err != nil {
			return
		}

		now := time.Now()
		if now.Sub(windowStart) >= wsRateWindow {
			msgCount = 0
			windowStart = now
		}
		msgCount++
		if msgCount > wsRateLimit {
			log.Printf("ws rate limit exceeded: user %s", c.UserID)
			return
		}

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		c.hub.HandleMessage(c, &msg)
	}
}

func (c *Client) authenticate() (*db.User, error) {
	authCtx, authCancel := context.WithTimeout(c.ctx, authTimeout)
	defer authCancel()

	_, data, err := c.conn.Read(authCtx)
	if err != nil {
		c.conn.Close(websocket.StatusPolicyViolation, "auth timeout")
		return nil, err
	}

	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		c.conn.Close(websocket.StatusPolicyViolation, "invalid message")
		return nil, err
	}

	if msg.Op != "authenticate" {
		c.conn.Close(websocket.StatusPolicyViolation, "expected authenticate")
		return nil, fmt.Errorf("expected authenticate, got %q", msg.Op)
	}

	var authData AuthenticateData
	if err := json.Unmarshal(msg.Data, &authData); err != nil {
		c.conn.Close(websocket.StatusPolicyViolation, "invalid auth data")
		return nil, err
	}

	user, err := c.hub.DB.GetUserByToken(authData.Token)
	if err != nil || user == nil {
		c.conn.Close(websocket.StatusPolicyViolation, "invalid token")
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("invalid token")
	}

	if !user.Approved {
		c.conn.Close(websocket.StatusPolicyViolation, "account pending approval")
		return nil, fmt.Errorf("user %s not approved", user.ID)
	}

	return user, nil
}

func (c *Client) sendReady() error {
	channels, err := c.hub.DB.GetAllChannels()
	if err != nil {
		return err
	}

	// Get all channel managers in one query
	allManagers, _ := c.hub.DB.GetAllChannelManagers()

	channelPayloads := make([]ChannelPayload, len(channels))
	for i, ch := range channels {
		mgrs := allManagers[ch.ID]
		if mgrs == nil {
			mgrs = []string{}
		}
		channelPayloads[i] = ChannelPayload{
			ID:         ch.ID,
			Name:       ch.Name,
			Type:       ch.Type,
			Position:   ch.Position,
			ManagerIDs: mgrs,
		}
	}

	// Get deleted channels for admin users
	var deletedChannelPayloads []ChannelPayload
	if c.User.IsAdmin {
		deletedChannels, _ := c.hub.DB.GetDeletedChannels()
		for _, ch := range deletedChannels {
			deletedChannelPayloads = append(deletedChannelPayloads, ChannelPayload{
				ID:         ch.ID,
				Name:       ch.Name,
				Type:       ch.Type,
				Position:   ch.Position,
				ManagerIDs: []string{},
			})
		}
	}

	onlineUsers := c.hub.OnlineUsers()

	// Get all registered users (approved only)
	dbAllUsers, _ := c.hub.DB.GetAllUsers()
	var allUsers []UserPayload
	for _, u := range dbAllUsers {
		if !u.Approved {
			continue
		}
		allUsers = append(allUsers, UserPayload{
			ID:       u.ID,
			Username: u.Username,
			IsAdmin:  u.IsAdmin,
		})
	}
	if allUsers == nil {
		allUsers = []UserPayload{}
	}

	// Get current voice states from SFU
	var voiceStates []VoiceStatePayload
	if c.hub.SFU != nil {
		for _, vs := range c.hub.SFU.VoiceStates() {
			voiceStates = append(voiceStates, VoiceStatePayload{
				UserID:     vs.UserID,
				ChannelID:  vs.ChannelID,
				SelfMute:   vs.SelfMute,
				SelfDeafen: vs.SelfDeafen,
				ServerMute: vs.ServerMute,
				Speaking:   vs.Speaking,
			})
		}
	}
	if voiceStates == nil {
		voiceStates = []VoiceStatePayload{}
	}

	// Get unread notifications
	dbNotifs, _ := c.hub.DB.GetUnreadNotifications(c.UserID, 50)
	notifPayloads := make([]NotificationPayload, len(dbNotifs))
	for i, n := range dbNotifs {
		notifPayloads[i] = NotificationPayload{
			ID:        n.ID,
			Type:      n.Type,
			Data:      n.Data,
			Read:      n.Read,
			CreatedAt: n.CreatedAt,
		}
	}

	// Get current screen shares from SFU
	var screenShares []sfu.ScreenShareState
	if c.hub.SFU != nil {
		screenShares = c.hub.SFU.ScreenShares()
	}
	if screenShares == nil {
		screenShares = []sfu.ScreenShareState{}
	}

	// Get media library
	dbMedia, _ := c.hub.DB.GetAllMedia()
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

	// Get current media playback state
	mediaPlayback := c.hub.GetMediaPlayback()

	// Get radio stations
	dbStations, _ := c.hub.DB.GetAllRadioStations()
	allStationManagers, _ := c.hub.DB.GetAllRadioStationManagers()
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

	// Get radio playback states
	radioPlayback := c.hub.GetAllRadioPlayback()

	// Get radio listeners
	radioListeners := c.hub.GetAllRadioListeners()

	// Get all radio playlists with tracks
	dbPlaylists, _ := c.hub.DB.GetAllPlaylists()
	playlistPayloads := make([]RadioPlaylistPayload, len(dbPlaylists))
	for i, p := range dbPlaylists {
		dbTracks, _ := c.hub.DB.GetTracksByPlaylist(p.ID)
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

	msg, err := NewMessage("ready", ReadyData{
		User: &UserPayload{
			ID:          c.User.ID,
			Username:    c.User.Username,
			Email:       c.User.Email,
			IsAdmin:     c.User.IsAdmin,
			HasPassword: c.User.PasswordHash != nil,
		},
		Channels:        channelPayloads,
		VoiceStates:     voiceStates,
		OnlineUsers:     onlineUsers,
		AllUsers:        allUsers,
		Notifications:   notifPayloads,
		ScreenShares:    screenShares,
		MediaList:       mediaPayloads,
		MediaPlayback:   mediaPlayback,
		DeletedChannels: deletedChannelPayloads,
		RadioStations:   stationPayloads,
		RadioPlayback:   radioPlayback,
		RadioPlaylists:  playlistPayloads,
		RadioListeners:  radioListeners,
		ServerTime:      nowUnix(),
	})
	if err != nil {
		return err
	}

	return c.conn.Write(c.ctx, websocket.MessageText, msg)
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingInterval)
	defer func() {
		ticker.Stop()
		c.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			if err := c.conn.Write(c.ctx, websocket.MessageText, msg); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.conn.Ping(c.ctx); err != nil {
				return
			}
		case <-c.ctx.Done():
			return
		}
	}
}

func (c *Client) Send(msg []byte) {
	select {
	case c.send <- msg:
	default:
		// Buffer full — disconnect slow client
		c.Close()
	}
}

func (c *Client) Close() {
	c.cancel()
	c.conn.Close(websocket.StatusNormalClosure, "")
}
