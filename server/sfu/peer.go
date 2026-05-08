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

	mu                 sync.RWMutex
	pc                 *webrtc.PeerConnection
	localTrack         *webrtc.TrackLocalStaticRTP
	room               *Room
	needsRenegotiation bool

	// Audio share state. A user may publish at most one additional
	// audio source ("share") alongside the mic. shareSourceID and
	// shareLabel are set eagerly by Room.StartShare when the share is
	// requested (so ready snapshots include it immediately).
	// shareLocalTrack is set in OnTrack once the publisher's RTP starts
	// flowing — its nil-ness distinguishes "share requested" from
	// "share active." Receivers see voice_audio_source_added either
	// way; the only effect of the wait-for-RTP is which moment other
	// peers start receiving frames.
	shareLocalTrack *webrtc.TrackLocalStaticRTP
	shareSourceID   string
	shareLabel      string

	SelfMute   bool
	SelfDeafen bool
	ServerMute bool
	Speaking   bool
}

// ShareSource is a snapshot of an active audio share for inclusion in
// ready / voice-state replays.
type ShareSource struct {
	UserID   string `json:"user_id"`
	SourceID string `json:"source_id"`
	Label    string `json:"label"`
}

// ActiveShare returns the peer's currently active share source, if any.
// Returns ("", "", false) when there is no active share.
func (p *Peer) ActiveShare() (sourceID, label string, ok bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if p.shareSourceID == "" {
		return "", "", false
	}
	return p.shareSourceID, p.shareLabel, true
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
