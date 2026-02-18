package sfu

import (
	"log"
	"sync"

	"github.com/pion/webrtc/v4"
)

type Room struct {
	ChannelID string
	sfu       *SFU
	mu        sync.RWMutex
	peers     map[string]*Peer // userID → peer
}

func newRoom(channelID string, sfu *SFU) *Room {
	return &Room{
		ChannelID: channelID,
		sfu:       sfu,
		peers:     make(map[string]*Peer),
	}
}

func (r *Room) AddPeer(userID string) (*Peer, error) {
	pc, err := r.sfu.api.NewPeerConnection(r.sfu.config)
	if err != nil {
		return nil, err
	}

	peer := &Peer{
		UserID:    userID,
		ChannelID: r.ChannelID,
		pc:        pc,
		room:      r,
	}

	// Add a transceiver for the peer to send audio
	_, err = pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	})
	if err != nil {
		pc.Close()
		return nil, err
	}

	// Handle incoming tracks from this peer
	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		log.Printf("sfu: room %s got track from %s", r.ChannelID, userID)

		// Create a local track to forward to other peers
		localTrack, err := webrtc.NewTrackLocalStaticRTP(
			track.Codec().RTPCodecCapability, track.ID(), track.StreamID(),
		)
		if err != nil {
			log.Printf("sfu: create local track: %v", err)
			return
		}

		peer.mu.Lock()
		peer.localTrack = localTrack
		peer.mu.Unlock()

		// Add this track to all other peers
		r.addTrackToOthers(userID, localTrack)

		// Forward RTP packets
		go func() {
			buf := make([]byte, 1500)
			for {
				n, _, err := track.Read(buf)
				if err != nil {
					return
				}

				peer.mu.RLock()
				muted := peer.ServerMute
				peer.mu.RUnlock()

				if muted {
					continue
				}

				if _, err := localTrack.Write(buf[:n]); err != nil {
					return
				}
			}
		}()
	})

	// Handle ICE candidates
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		if r.sfu.Signal != nil {
			r.sfu.Signal(userID, "webrtc_ice", map[string]any{
				"candidate": c.ToJSON(),
			})
		}
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("sfu: room %s peer %s state: %s", r.ChannelID, userID, state)
		if state == webrtc.PeerConnectionStateFailed ||
			state == webrtc.PeerConnectionStateClosed {
			r.RemovePeer(userID)
		}
	})

	// Add existing peers' tracks to this new peer
	r.mu.RLock()
	for otherID, otherPeer := range r.peers {
		if otherID == userID {
			continue
		}
		otherPeer.mu.RLock()
		lt := otherPeer.localTrack
		otherPeer.mu.RUnlock()

		if lt != nil {
			sender, err := pc.AddTrack(lt)
			if err != nil {
				log.Printf("sfu: add existing track to new peer: %v", err)
			} else {
				// Read RTCP (required for the sender to work)
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
	}
	r.mu.RUnlock()

	// Create and send offer BEFORE adding to peers map.
	// This ensures that when the peer is visible to other goroutines,
	// the PC is already in have-local-offer state and renegotiation
	// will correctly defer via the needsRenegotiation flag.
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		pc.Close()
		return nil, err
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		pc.Close()
		return nil, err
	}

	r.mu.Lock()
	r.peers[userID] = peer
	r.mu.Unlock()

	// Send the offer to the client
	if r.sfu.Signal != nil {
		r.sfu.Signal(userID, "webrtc_offer", map[string]string{
			"sdp": offer.SDP,
		})
	}

	return peer, nil
}

func (r *Room) RemovePeer(userID string) {
	r.mu.Lock()
	peer, ok := r.peers[userID]
	if !ok {
		r.mu.Unlock()
		return
	}
	delete(r.peers, userID)
	empty := len(r.peers) == 0
	r.mu.Unlock()

	peer.pc.Close()

	// Notify the WS layer so it can broadcast voice_state_update
	if r.sfu.OnPeerRemoved != nil {
		r.sfu.OnPeerRemoved(userID)
	}

	// Renegotiate remaining peers to remove the departed user's track
	r.mu.RLock()
	for _, p := range r.peers {
		r.renegotiatePeer(p)
	}
	r.mu.RUnlock()

	if empty {
		r.sfu.RemoveRoom(r.ChannelID)
	}
}

func (r *Room) addTrackToOthers(fromUserID string, track *webrtc.TrackLocalStaticRTP) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	log.Printf("sfu: addTrackToOthers from %s, other peers: %d", fromUserID, len(r.peers)-1)
	for uid, peer := range r.peers {
		if uid == fromUserID {
			continue
		}
		log.Printf("sfu: adding track from %s to %s (signaling=%s)", fromUserID, uid, peer.pc.SignalingState())
		sender, err := peer.pc.AddTrack(track)
		if err != nil {
			log.Printf("sfu: add track to peer %s: %v", uid, err)
			continue
		}
		// Read RTCP
		go func() {
			buf := make([]byte, 1500)
			for {
				if _, _, err := sender.Read(buf); err != nil {
					return
				}
			}
		}()

		r.renegotiatePeer(peer)
	}
}

func (r *Room) renegotiatePeer(peer *Peer) {
	// Only renegotiate when signaling state is stable.
	// If not stable, mark the peer so HandleAnswer triggers renegotiation later.
	peer.mu.Lock()
	if peer.pc.SignalingState() != webrtc.SignalingStateStable {
		peer.needsRenegotiation = true
		peer.mu.Unlock()
		log.Printf("sfu: deferring renegotiation for %s (state=%s)", peer.UserID, peer.pc.SignalingState())
		return
	}
	peer.needsRenegotiation = false
	peer.mu.Unlock()

	offer, err := peer.pc.CreateOffer(nil)
	if err != nil {
		log.Printf("sfu: renegotiate offer: %v", err)
		return
	}
	if err := peer.pc.SetLocalDescription(offer); err != nil {
		log.Printf("sfu: set local desc: %v", err)
		return
	}
	if r.sfu.Signal != nil {
		log.Printf("sfu: sent renegotiation offer to %s", peer.UserID)
		r.sfu.Signal(peer.UserID, "webrtc_offer", map[string]string{
			"sdp": offer.SDP,
		})
	}
}

func (r *Room) HandleAnswer(userID string, sdp string) {
	r.mu.RLock()
	peer, ok := r.peers[userID]
	r.mu.RUnlock()
	if !ok {
		log.Printf("sfu: HandleAnswer: peer %s not found", userID)
		return
	}

	log.Printf("sfu: HandleAnswer from %s (signaling=%s)", userID, peer.pc.SignalingState())
	err := peer.pc.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  sdp,
	})
	if err != nil {
		log.Printf("sfu: set remote desc for %s: %v", userID, err)
		return
	}
	log.Printf("sfu: HandleAnswer success for %s, now signaling=%s", userID, peer.pc.SignalingState())

	// If renegotiation was deferred while we were waiting for this answer,
	// trigger it now that signaling state is back to stable.
	peer.mu.Lock()
	needsRenego := peer.needsRenegotiation
	peer.needsRenegotiation = false
	peer.mu.Unlock()

	if needsRenego {
		log.Printf("sfu: running deferred renegotiation for %s", userID)
		r.renegotiatePeer(peer)
	}
}

func (r *Room) HandleICE(userID string, candidate webrtc.ICECandidateInit) {
	r.mu.RLock()
	peer, ok := r.peers[userID]
	r.mu.RUnlock()
	if !ok {
		return
	}

	if err := peer.pc.AddICECandidate(candidate); err != nil {
		log.Printf("sfu: add ICE for %s: %v", userID, err)
	}
}

func (r *Room) PeerCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.peers)
}

func (r *Room) GetPeer(userID string) *Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.peers[userID]
}

func (r *Room) PeerIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.peers))
	for id := range r.peers {
		ids = append(ids, id)
	}
	return ids
}
