package sfu

import (
	"fmt"
	"log"
	"sync"

	"github.com/pion/webrtc/v4"
)

type ScreenRoom struct {
	ChannelID   string
	PresenterID string
	sfu         *SFU
	mu          sync.RWMutex
	presenterPC *webrtc.PeerConnection
	videoTrack  *webrtc.TrackLocalStaticRTP
	audioTrack  *webrtc.TrackLocalStaticRTP
	viewers     map[string]*ScreenViewer
	stopped     bool
}

type ScreenViewer struct {
	UserID             string
	pc                 *webrtc.PeerConnection
	mu                 sync.Mutex
	needsRenegotiation bool
}

func newScreenRoom(channelID, presenterID string, sfu *SFU) *ScreenRoom {
	return &ScreenRoom{
		ChannelID:   channelID,
		PresenterID: presenterID,
		sfu:         sfu,
		viewers:     make(map[string]*ScreenViewer),
	}
}

func (sr *ScreenRoom) SetupPresenter() error {
	pc, err := sr.sfu.screenAPI.NewPeerConnection(sr.sfu.config)
	if err != nil {
		return fmt.Errorf("create presenter PC: %w", err)
	}

	// Recv-only transceiver for video
	_, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	})
	if err != nil {
		pc.Close()
		return fmt.Errorf("add video transceiver: %w", err)
	}

	// Recv-only transceiver for audio (screen audio)
	_, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	})
	if err != nil {
		pc.Close()
		return fmt.Errorf("add audio transceiver: %w", err)
	}

	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("sfu/screen: room %s got %s track from presenter %s", sr.ChannelID, track.Kind(), sr.PresenterID)

		localTrack, err := webrtc.NewTrackLocalStaticRTP(
			track.Codec().RTPCodecCapability, track.ID(), track.StreamID(),
		)
		if err != nil {
			log.Printf("sfu/screen: create local track: %v", err)
			return
		}

		sr.mu.Lock()
		if track.Kind() == webrtc.RTPCodecTypeVideo {
			sr.videoTrack = localTrack
		} else {
			sr.audioTrack = localTrack
		}
		sr.mu.Unlock()

		// Add this track to existing viewers
		sr.addTrackToViewers(localTrack)

		// Forward RTP packets
		go func() {
			buf := make([]byte, 1500)
			for {
				n, _, err := track.Read(buf)
				if err != nil {
					return
				}
				if _, err := localTrack.Write(buf[:n]); err != nil {
					return
				}
			}
		}()
	})

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		if sr.sfu.Signal != nil {
			sr.sfu.Signal(sr.PresenterID, "webrtc_screen_ice", map[string]any{
				"candidate": c.ToJSON(),
			})
		}
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("sfu/screen: presenter %s state: %s", sr.PresenterID, state)
		if state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateClosed {
			sr.sfu.StopScreenShare(sr.ChannelID)
		}
	})

	// Create offer for presenter
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		pc.Close()
		return fmt.Errorf("create offer: %w", err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		pc.Close()
		return fmt.Errorf("set local desc: %w", err)
	}

	sr.mu.Lock()
	sr.presenterPC = pc
	sr.mu.Unlock()

	if sr.sfu.Signal != nil {
		sr.sfu.Signal(sr.PresenterID, "webrtc_screen_offer", map[string]string{
			"sdp": offer.SDP,
		})
	}

	return nil
}

func (sr *ScreenRoom) AddViewer(userID string) error {
	pc, err := sr.sfu.screenAPI.NewPeerConnection(sr.sfu.config)
	if err != nil {
		return fmt.Errorf("create viewer PC: %w", err)
	}

	viewer := &ScreenViewer{
		UserID: userID,
		pc:     pc,
	}

	// Add forwarding tracks if available
	sr.mu.RLock()
	vt := sr.videoTrack
	at := sr.audioTrack
	sr.mu.RUnlock()

	if vt != nil {
		sender, err := pc.AddTrack(vt)
		if err != nil {
			log.Printf("sfu/screen: add video track to viewer %s: %v", userID, err)
		} else {
			go func() {
				buf := make([]byte, 1500)
				for {
					if _, _, err := sender.Read(buf); err != nil {
						return
					}
				}
			}()
		}
	}

	if at != nil {
		sender, err := pc.AddTrack(at)
		if err != nil {
			log.Printf("sfu/screen: add audio track to viewer %s: %v", userID, err)
		} else {
			go func() {
				buf := make([]byte, 1500)
				for {
					if _, _, err := sender.Read(buf); err != nil {
						return
					}
				}
			}()
		}
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		if sr.sfu.Signal != nil {
			sr.sfu.Signal(userID, "webrtc_screen_ice", map[string]any{
				"candidate": c.ToJSON(),
			})
		}
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("sfu/screen: viewer %s state: %s", userID, state)
		if state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateClosed {
			sr.RemoveViewer(userID)
		}
	})

	// Create offer for viewer
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		pc.Close()
		return fmt.Errorf("create viewer offer: %w", err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		pc.Close()
		return fmt.Errorf("set viewer local desc: %w", err)
	}

	sr.mu.Lock()
	sr.viewers[userID] = viewer
	sr.mu.Unlock()

	if sr.sfu.Signal != nil {
		sr.sfu.Signal(userID, "webrtc_screen_offer", map[string]string{
			"sdp": offer.SDP,
		})
	}

	return nil
}

func (sr *ScreenRoom) RemoveViewer(userID string) {
	sr.mu.Lock()
	viewer, ok := sr.viewers[userID]
	if !ok {
		sr.mu.Unlock()
		return
	}
	delete(sr.viewers, userID)
	sr.mu.Unlock()

	viewer.pc.Close()
}

func (sr *ScreenRoom) Stop() {
	sr.mu.Lock()
	if sr.stopped {
		sr.mu.Unlock()
		return
	}
	sr.stopped = true
	viewers := make([]*ScreenViewer, 0, len(sr.viewers))
	for _, v := range sr.viewers {
		viewers = append(viewers, v)
	}
	sr.viewers = make(map[string]*ScreenViewer)
	pc := sr.presenterPC
	sr.presenterPC = nil
	sr.mu.Unlock()

	for _, v := range viewers {
		v.pc.Close()
	}
	if pc != nil {
		pc.Close()
	}
}

func (sr *ScreenRoom) HandleAnswer(userID string, sdp string) {
	sr.mu.RLock()
	defer sr.mu.RUnlock()

	var pc *webrtc.PeerConnection
	if userID == sr.PresenterID {
		pc = sr.presenterPC
	} else if viewer, ok := sr.viewers[userID]; ok {
		pc = viewer.pc
	}

	if pc == nil {
		return
	}

	err := pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	})
	if err != nil {
		log.Printf("sfu/screen: set remote desc for %s: %v", userID, err)
		return
	}

	// Handle deferred renegotiation for viewers
	if userID != sr.PresenterID {
		if viewer, ok := sr.viewers[userID]; ok {
			viewer.mu.Lock()
			needsRenego := viewer.needsRenegotiation
			viewer.needsRenegotiation = false
			viewer.mu.Unlock()

			if needsRenego {
				log.Printf("sfu/screen: running deferred renegotiation for viewer %s", userID)
				sr.renegotiateViewer(viewer)
			}
		}
	}
}

func (sr *ScreenRoom) HandleICE(userID string, candidate webrtc.ICECandidateInit) {
	sr.mu.RLock()
	defer sr.mu.RUnlock()

	var pc *webrtc.PeerConnection
	if userID == sr.PresenterID {
		pc = sr.presenterPC
	} else if viewer, ok := sr.viewers[userID]; ok {
		pc = viewer.pc
	}

	if pc == nil {
		return
	}

	if err := pc.AddICECandidate(candidate); err != nil {
		log.Printf("sfu/screen: add ICE for %s: %v", userID, err)
	}
}

func (sr *ScreenRoom) ViewerCount() int {
	sr.mu.RLock()
	defer sr.mu.RUnlock()
	return len(sr.viewers)
}

func (sr *ScreenRoom) addTrackToViewers(track *webrtc.TrackLocalStaticRTP) {
	sr.mu.RLock()
	defer sr.mu.RUnlock()

	for uid, viewer := range sr.viewers {
		sender, err := viewer.pc.AddTrack(track)
		if err != nil {
			log.Printf("sfu/screen: add track to viewer %s: %v", uid, err)
			continue
		}
		go func() {
			buf := make([]byte, 1500)
			for {
				if _, _, err := sender.Read(buf); err != nil {
					return
				}
			}
		}()

		sr.renegotiateViewer(viewer)
	}
}

func (sr *ScreenRoom) renegotiateViewer(viewer *ScreenViewer) {
	viewer.mu.Lock()
	if viewer.pc.SignalingState() != webrtc.SignalingStateStable {
		viewer.needsRenegotiation = true
		viewer.mu.Unlock()
		log.Printf("sfu/screen: deferring renegotiation for viewer %s (state=%s)", viewer.UserID, viewer.pc.SignalingState())
		return
	}
	viewer.needsRenegotiation = false
	viewer.mu.Unlock()

	offer, err := viewer.pc.CreateOffer(nil)
	if err != nil {
		log.Printf("sfu/screen: renegotiate offer for viewer %s: %v", viewer.UserID, err)
		return
	}
	if err := viewer.pc.SetLocalDescription(offer); err != nil {
		log.Printf("sfu/screen: set local desc for viewer %s: %v", viewer.UserID, err)
		return
	}
	if sr.sfu.Signal != nil {
		sr.sfu.Signal(viewer.UserID, "webrtc_screen_offer", map[string]string{
			"sdp": offer.SDP,
		})
	}
}
