package sfu

import (
	"log"
	"sync"

	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/nack"
	"github.com/pion/webrtc/v4"
)

// Callback types for signaling back to the WS layer
type SignalFunc func(userID string, op string, data any)
type PeerRemovedFunc func(userID string)

type SFU struct {
	mu            sync.RWMutex
	rooms         map[string]*Room // channelID → room
	config        webrtc.Configuration
	api           *webrtc.API
	Signal        SignalFunc
	OnPeerRemoved PeerRemovedFunc
}

func New(stunServer string, publicIP string) *SFU {
	// Media engine: Opus only
	me := &webrtc.MediaEngine{}
	if err := me.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;useinbandfec=1;usedtx=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		log.Printf("sfu: register codec: %v", err)
	}

	// Interceptor: NACK for reliability
	ir := &interceptor.Registry{}
	responder, _ := nack.NewResponderInterceptor()
	ir.Add(responder)
	generator, _ := nack.NewGeneratorInterceptor()
	ir.Add(generator)

	se := webrtc.SettingEngine{}
	if publicIP != "" {
		se.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}

	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(me),
		webrtc.WithInterceptorRegistry(ir),
		webrtc.WithSettingEngine(se),
	)

	iceServers := []webrtc.ICEServer{}
	if stunServer != "" {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs: []string{stunServer},
		})
	}

	return &SFU{
		rooms: make(map[string]*Room),
		config: webrtc.Configuration{
			ICEServers: iceServers,
		},
		api: api,
	}
}

func (s *SFU) GetOrCreateRoom(channelID string) *Room {
	s.mu.Lock()
	defer s.mu.Unlock()

	if room, ok := s.rooms[channelID]; ok {
		return room
	}

	room := newRoom(channelID, s)
	s.rooms[channelID] = room
	return room
}

func (s *SFU) GetRoom(channelID string) *Room {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.rooms[channelID]
}

func (s *SFU) RemoveRoom(channelID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.rooms, channelID)
}

// GetUserRoom returns the room a user is currently in, or nil
func (s *SFU) GetUserRoom(userID string) *Room {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, room := range s.rooms {
		room.mu.RLock()
		_, exists := room.peers[userID]
		room.mu.RUnlock()
		if exists {
			return room
		}
	}
	return nil
}

// VoiceStates returns all current voice states across all rooms
func (s *SFU) VoiceStates() []VoiceState {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var states []VoiceState
	for _, room := range s.rooms {
		room.mu.RLock()
		for _, p := range room.peers {
			states = append(states, p.VoiceState())
		}
		room.mu.RUnlock()
	}
	return states
}
