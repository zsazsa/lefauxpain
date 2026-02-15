package sfu

import (
	"fmt"
	"log"
	"sync"

	"github.com/pion/interceptor"
	"github.com/pion/interceptor/pkg/nack"
	"github.com/pion/webrtc/v4"
)

// Callback types for signaling back to the WS layer
type SignalFunc func(userID string, op string, data any)
type PeerRemovedFunc func(userID string)
type ScreenShareStoppedFunc func(presenterID string, channelID string)

type ScreenShareState struct {
	UserID    string `json:"user_id"`
	ChannelID string `json:"channel_id"`
}

type SFU struct {
	mu            sync.RWMutex
	rooms         map[string]*Room       // channelID → room
	screenRooms   map[string]*ScreenRoom // channelID → screen room
	config        webrtc.Configuration
	api           *webrtc.API
	screenAPI     *webrtc.API
	Signal               SignalFunc
	OnPeerRemoved        PeerRemovedFunc
	OnScreenShareStopped ScreenShareStoppedFunc
}

func New(stunServer string, publicIP string) *SFU {
	// Media engine: Opus only (for voice)
	me := &webrtc.MediaEngine{}
	if err := me.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=128000",
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

	// Screen share media engine: VP8 video + Opus audio
	screenME := &webrtc.MediaEngine{}
	if err := screenME.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeVP8,
			ClockRate:   90000,
		},
		PayloadType: 96,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		log.Printf("sfu: register VP8 codec: %v", err)
	}
	if err := screenME.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    webrtc.MimeTypeOpus,
			ClockRate:   48000,
			Channels:    2,
			SDPFmtpLine: "minptime=10;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		log.Printf("sfu: register screen Opus codec: %v", err)
	}

	screenIR := &interceptor.Registry{}
	// Explicit NACK interceptors for packet retransmission (critical for video quality)
	screenNackResp, _ := nack.NewResponderInterceptor()
	screenIR.Add(screenNackResp)
	screenNackGen, _ := nack.NewGeneratorInterceptor()
	screenIR.Add(screenNackGen)
	if err := webrtc.RegisterDefaultInterceptors(screenME, screenIR); err != nil {
		log.Printf("sfu: register screen interceptors: %v", err)
	}

	screenSE := webrtc.SettingEngine{}
	if publicIP != "" {
		screenSE.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}

	screenAPI := webrtc.NewAPI(
		webrtc.WithMediaEngine(screenME),
		webrtc.WithInterceptorRegistry(screenIR),
		webrtc.WithSettingEngine(screenSE),
	)

	iceServers := []webrtc.ICEServer{}
	if stunServer != "" {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs: []string{stunServer},
		})
	}

	return &SFU{
		rooms:       make(map[string]*Room),
		screenRooms: make(map[string]*ScreenRoom),
		config: webrtc.Configuration{
			ICEServers: iceServers,
		},
		api:       api,
		screenAPI: screenAPI,
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

// Screen share methods

func (s *SFU) StartScreenShare(channelID, presenterID string) (*ScreenRoom, error) {
	s.mu.Lock()
	if _, exists := s.screenRooms[channelID]; exists {
		s.mu.Unlock()
		return nil, fmt.Errorf("screen share already active in channel %s", channelID)
	}
	sr := newScreenRoom(channelID, presenterID, s)
	s.screenRooms[channelID] = sr
	s.mu.Unlock()

	if err := sr.SetupPresenter(); err != nil {
		s.mu.Lock()
		delete(s.screenRooms, channelID)
		s.mu.Unlock()
		return nil, err
	}

	return sr, nil
}

func (s *SFU) StopScreenShare(channelID string) {
	s.mu.Lock()
	sr, ok := s.screenRooms[channelID]
	if !ok {
		s.mu.Unlock()
		return
	}
	delete(s.screenRooms, channelID)
	s.mu.Unlock()

	presenterID := sr.PresenterID
	sr.Stop()

	if s.OnScreenShareStopped != nil {
		s.OnScreenShareStopped(presenterID, channelID)
	}
}

func (s *SFU) GetScreenRoom(channelID string) *ScreenRoom {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.screenRooms[channelID]
}

func (s *SFU) GetUserScreenRoom(userID string) *ScreenRoom {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sr := range s.screenRooms {
		if sr.PresenterID == userID {
			return sr
		}
	}
	return nil
}

func (s *SFU) ScreenShares() []ScreenShareState {
	s.mu.RLock()
	defer s.mu.RUnlock()
	states := make([]ScreenShareState, 0, len(s.screenRooms))
	for _, sr := range s.screenRooms {
		states = append(states, ScreenShareState{
			UserID:    sr.PresenterID,
			ChannelID: sr.ChannelID,
		})
	}
	return states
}

func (s *SFU) HandleScreenAnswer(userID string, sdp string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sr := range s.screenRooms {
		if sr.PresenterID == userID {
			sr.HandleAnswer(userID, sdp)
			return
		}
	}
	// Check viewers
	for _, sr := range s.screenRooms {
		sr.mu.RLock()
		_, isViewer := sr.viewers[userID]
		sr.mu.RUnlock()
		if isViewer {
			sr.HandleAnswer(userID, sdp)
			return
		}
	}
}

func (s *SFU) HandleScreenICE(userID string, candidate webrtc.ICECandidateInit) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, sr := range s.screenRooms {
		if sr.PresenterID == userID {
			sr.HandleICE(userID, candidate)
			return
		}
	}
	// Check viewers
	for _, sr := range s.screenRooms {
		sr.mu.RLock()
		_, isViewer := sr.viewers[userID]
		sr.mu.RUnlock()
		if isViewer {
			sr.HandleICE(userID, candidate)
			return
		}
	}
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
