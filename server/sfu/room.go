package sfu

import (
	"fmt"
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

	// Handle incoming tracks from this peer.
	// The first inbound track is the mic. Subsequent inbound tracks are
	// audio shares — Room.StartShare sets shareSourceID before adding
	// the recvonly transceiver, and we identify the share track here by
	// "mic already exists AND share requested but not yet wired up."
	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		peer.mu.Lock()
		isShare := peer.localTrack != nil && peer.shareSourceID != "" && peer.shareLocalTrack == nil
		var sourceID string
		if isShare {
			sourceID = peer.shareSourceID
		}
		peer.mu.Unlock()

		log.Printf("sfu: room %s got track from %s (share=%v sourceID=%q)", r.ChannelID, userID, isShare, sourceID)

		// Use a stream ID that encodes the source so receivers can
		// correlate ontrack events with voice_audio_source_added events.
		streamID := track.StreamID()
		if isShare {
			streamID = "share:" + sourceID
		}
		localTrack, err := webrtc.NewTrackLocalStaticRTP(
			track.Codec().RTPCodecCapability, track.ID(), streamID,
		)
		if err != nil {
			log.Printf("sfu: create local track: %v", err)
			return
		}

		peer.mu.Lock()
		if isShare {
			peer.shareLocalTrack = localTrack
		} else {
			peer.localTrack = localTrack
		}
		peer.mu.Unlock()

		// Add this track to all other peers (mic OR share — same path)
		r.addTrackToOthers(userID, localTrack)

		// Forward RTP packets. ServerMute applies only to the mic; the
		// share is independent so it can keep flowing while the mic is
		// server-muted.
		go func() {
			buf := make([]byte, 1500)
			for {
				n, _, err := track.Read(buf)
				if err != nil {
					return
				}

				if !isShare {
					peer.mu.RLock()
					muted := peer.ServerMute
					peer.mu.RUnlock()
					if muted {
						continue
					}
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

	// Add existing peers' tracks to this new peer (mic + any active share)
	r.mu.RLock()
	for otherID, otherPeer := range r.peers {
		if otherID == userID {
			continue
		}
		otherPeer.mu.RLock()
		mic := otherPeer.localTrack
		share := otherPeer.shareLocalTrack
		otherPeer.mu.RUnlock()

		for _, lt := range []*webrtc.TrackLocalStaticRTP{mic, share} {
			if lt == nil {
				continue
			}
			sender, err := pc.AddTrack(lt)
			if err != nil {
				log.Printf("sfu: add existing track to new peer: %v", err)
				continue
			}
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
	// Snapshot share state before tearing down so the hub can broadcast
	// voice_audio_source_removed regardless of which path triggered the
	// removal (explicit leave_voice, channel switch, WS unregister, or
	// PC OnConnectionStateChange).
	peer.mu.Lock()
	endedShareID := peer.shareSourceID
	peer.mu.Unlock()
	delete(r.peers, userID)
	empty := len(r.peers) == 0
	r.mu.Unlock()

	// Fire share-ended and peer-removed callbacks first. Receivers
	// should learn the share is gone before they learn the user is gone.
	if endedShareID != "" && r.sfu.OnShareEnded != nil {
		r.sfu.OnShareEnded(userID, endedShareID)
	}
	if r.sfu.OnPeerRemoved != nil {
		r.sfu.OnPeerRemoved(userID)
	}

	// Close the PC asynchronously. A never-answered PC can block on
	// ICE/DTLS timeout — we don't want that to stall the hub run loop
	// when this RemovePeer is called from the unregister handler.
	go peer.pc.Close()

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

// StartShare adds a recvonly audio transceiver to the user's peer
// connection and triggers renegotiation. The client is expected to
// attach the share MediaStreamTrack to the new transceiver and answer.
// On answer + first RTP, OnTrack will fire and Room will mint a forward
// track and call sfu.OnShareStarted to notify the hub.
//
// Returns an error if the user is not in the room or already has an
// active or pending share.
func (r *Room) StartShare(userID, sourceID, label string) error {
	r.mu.RLock()
	peer, ok := r.peers[userID]
	r.mu.RUnlock()
	if !ok {
		return fmt.Errorf("user %s not in room %s", userID, r.ChannelID)
	}

	peer.mu.Lock()
	if peer.shareSourceID != "" {
		peer.mu.Unlock()
		return fmt.Errorf("user %s already has an active share", userID)
	}
	peer.shareSourceID = sourceID
	peer.shareLabel = label
	peer.mu.Unlock()

	// Adding a transceiver mid-session triggers a renegotiation; the
	// existing renegotiatePeer handles in-flight negotiation via the
	// needsRenegotiation flag.
	if _, err := peer.pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio, webrtc.RTPTransceiverInit{
		Direction: webrtc.RTPTransceiverDirectionRecvonly,
	}); err != nil {
		peer.mu.Lock()
		peer.shareSourceID = ""
		peer.shareLabel = ""
		peer.mu.Unlock()
		return fmt.Errorf("add share transceiver: %w", err)
	}

	r.renegotiatePeer(peer)
	return nil
}

// StopShare ends the user's active share. Removes the forward track
// from every other peer in the room (which triggers their
// renegotiation), clears the publisher's share state, and returns the
// previous source ID for the hub to broadcast voice_audio_source_removed.
//
// Returns ("", false) if the user has no active share.
func (r *Room) StopShare(userID string) (sourceID string, ok bool) {
	r.mu.RLock()
	peer, exists := r.peers[userID]
	r.mu.RUnlock()
	if !exists {
		return "", false
	}

	peer.mu.Lock()
	share := peer.shareLocalTrack
	sourceID = peer.shareSourceID
	peer.shareLocalTrack = nil
	peer.shareSourceID = ""
	peer.shareLabel = ""
	peer.mu.Unlock()

	if sourceID == "" {
		return "", false
	}

	// If the publisher's track never started flowing (no RTP yet),
	// there is no forwarded localTrack to remove from other peers — the
	// indicator was broadcast at start time and we just need to undo the
	// transceiver state. Receivers see voice_audio_source_removed and
	// drop the indicator. Renegotiation of the publisher will happen on
	// the next state change.
	if share == nil {
		return sourceID, true
	}

	// Remove the share track from each other peer's PC and renegotiate.
	r.mu.RLock()
	others := make([]*Peer, 0, len(r.peers))
	for uid, p := range r.peers {
		if uid != userID {
			others = append(others, p)
		}
	}
	r.mu.RUnlock()

	for _, other := range others {
		for _, sender := range other.pc.GetSenders() {
			if sender.Track() == share {
				if err := other.pc.RemoveTrack(sender); err != nil {
					log.Printf("sfu: remove share track from %s: %v", other.UserID, err)
				}
				break
			}
		}
		r.renegotiatePeer(other)
	}

	return sourceID, true
}

// ActiveShares returns a snapshot of all active shares in this room.
func (r *Room) ActiveShares() []ShareSource {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ShareSource, 0)
	for _, p := range r.peers {
		if sourceID, label, ok := p.ActiveShare(); ok {
			out = append(out, ShareSource{
				UserID:   p.UserID,
				SourceID: sourceID,
				Label:    label,
			})
		}
	}
	return out
}
