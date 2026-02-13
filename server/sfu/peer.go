package sfu

import (
	"sync"

	"github.com/pion/webrtc/v4"
)

type VoiceState struct {
	UserID     string `json:"user_id"`
	ChannelID  string `json:"channel_id"`
	SelfMute   bool   `json:"self_mute"`
	SelfDeafen bool   `json:"self_deafen"`
	ServerMute bool   `json:"server_mute"`
	Speaking   bool   `json:"speaking"`
}

type Peer struct {
	UserID    string
	ChannelID string

	mu                  sync.RWMutex
	pc                  *webrtc.PeerConnection
	localTrack          *webrtc.TrackLocalStaticRTP
	room                *Room
	needsRenegotiation  bool

	SelfMute   bool
	SelfDeafen bool
	ServerMute bool
	Speaking   bool
}

func (p *Peer) VoiceState() VoiceState {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return VoiceState{
		UserID:     p.UserID,
		ChannelID:  p.ChannelID,
		SelfMute:   p.SelfMute,
		SelfDeafen: p.SelfDeafen,
		ServerMute: p.ServerMute,
		Speaking:   p.Speaking,
	}
}

func (p *Peer) SetSelfMute(muted bool) {
	p.mu.Lock()
	p.SelfMute = muted
	p.mu.Unlock()
}

func (p *Peer) SetSelfDeafen(deafened bool) {
	p.mu.Lock()
	p.SelfDeafen = deafened
	p.mu.Unlock()
}

func (p *Peer) SetServerMute(muted bool) {
	p.mu.Lock()
	p.ServerMute = muted
	p.mu.Unlock()
}

func (p *Peer) SetSpeaking(speaking bool) {
	p.mu.Lock()
	p.Speaking = speaking
	p.mu.Unlock()
}
