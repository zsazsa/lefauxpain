package ws

import "encoding/json"

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
	User         *UserPayload       `json:"user"`
	Channels     []ChannelPayload   `json:"channels"`
	VoiceStates  []VoiceStatePayload `json:"voice_states"`
	OnlineUsers  []UserPayload      `json:"online_users"`
}

type UserPayload struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatar_url"`
}

type ChannelPayload struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Position int    `json:"position"`
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

func NewMessage(op string, data any) ([]byte, error) {
	d, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return json.Marshal(Message{Op: op, Data: d})
}
