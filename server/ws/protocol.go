package ws

import (
	"encoding/json"

	"github.com/kalman/voicechat/sfu"
)

type Message struct {
	Op   string          `json:"op"`
	Data json.RawMessage `json:"d"`
}

// Client → Server auth
type AuthenticateData struct {
	Token string `json:"token"`
}

// Server → Client ready event
type ReadyData struct {
	User           *UserPayload           `json:"user"`
	Channels       []ChannelPayload       `json:"channels"`
	VoiceStates    []VoiceStatePayload    `json:"voice_states"`
	OnlineUsers    []UserPayload          `json:"online_users"`
	AllUsers       []UserPayload          `json:"all_users"`
	Notifications  []NotificationPayload  `json:"notifications"`
	ScreenShares   []sfu.ScreenShareState `json:"screen_shares"`
	MediaList      []MediaItemPayload     `json:"media_list"`
	MediaPlayback   *MediaPlaybackPayload             `json:"media_playback"`
	DeletedChannels []ChannelPayload                  `json:"deleted_channels,omitempty"`
	RadioStations   []RadioStationPayload             `json:"radio_stations"`
	RadioPlayback   map[string]*RadioPlaybackPayload  `json:"radio_playback"`
	RadioPlaylists  []RadioPlaylistPayload            `json:"radio_playlists"`
}

type MediaItemPayload struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	URL       string `json:"url"`
	MimeType  string `json:"mime_type"`
	SizeBytes int64  `json:"size_bytes"`
	CreatedAt string `json:"created_at"`
}

type MediaPlaybackPayload struct {
	VideoID   string  `json:"video_id"`
	Playing   bool    `json:"playing"`
	Position  float64 `json:"position"`
	UpdatedAt float64 `json:"updated_at"` // Unix timestamp in seconds (with fractional)
}

type NotificationPayload struct {
	ID             string  `json:"id"`
	MessageID      string  `json:"message_id"`
	ChannelID      string  `json:"channel_id"`
	ChannelName    string  `json:"channel_name"`
	Author         UserPayload `json:"author"`
	ContentPreview *string `json:"content_preview"`
	Read           bool    `json:"read"`
	CreatedAt      string  `json:"created_at"`
}

type UserPayload struct {
	ID          string  `json:"id"`
	Username    string  `json:"username"`
	AvatarURL   *string `json:"avatar_url"`
	IsAdmin     bool    `json:"is_admin"`
	HasPassword bool    `json:"has_password,omitempty"`
}

type ChannelPayload struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Type       string   `json:"type"`
	Position   int      `json:"position"`
	ManagerIDs []string `json:"manager_ids"`
}

type VoiceStatePayload struct {
	UserID     string `json:"user_id"`
	ChannelID  string `json:"channel_id"`
	SelfMute   bool   `json:"self_mute"`
	SelfDeafen bool   `json:"self_deafen"`
	ServerMute bool   `json:"server_mute"`
	Speaking   bool   `json:"speaking"`
}

// Server → Client presence
type UserOnlineData struct {
	User UserPayload `json:"user"`
}

type UserOfflineData struct {
	UserID string `json:"user_id"`
}

// Radio payload types

type RadioStationPayload struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	CreatedBy *string `json:"created_by"`
	Position  int     `json:"position"`
}

type RadioPlaylistPayload struct {
	ID     string              `json:"id"`
	Name   string              `json:"name"`
	UserID string              `json:"user_id"`
	Tracks []RadioTrackPayload `json:"tracks"`
}

type RadioTrackPayload struct {
	ID       string  `json:"id"`
	Filename string  `json:"filename"`
	URL      string  `json:"url"`
	Duration float64 `json:"duration"`
	Position int     `json:"position"`
}

type RadioPlaybackPayload struct {
	StationID  string           `json:"station_id"`
	PlaylistID string           `json:"playlist_id"`
	TrackIndex int              `json:"track_index"`
	Track      RadioTrackPayload `json:"track"`
	Playing    bool             `json:"playing"`
	Position   float64          `json:"position"`
	UpdatedAt  float64          `json:"updated_at"`
	UserID     string           `json:"user_id"`
}

func NewMessage(op string, data any) ([]byte, error) {
	d, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Message{Op: op, Data: d})
}
