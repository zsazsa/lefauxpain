use std::sync::Arc;
use tokio::sync::mpsc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;
use webrtc::rtp_transceiver::rtp_codec::{RTCRtpCodecCapability, RTCRtpCodecParameters, RTPCodecType};
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocal;
use webrtc::track::track_remote::TrackRemote;

use super::types::{IceCandidateIn, IceCandidateOut};

/// Events emitted by the peer connection.
pub enum PeerEvent {
    IceCandidate(IceCandidateOut),
    RemoteTrack(Arc<TrackRemote>),
    ConnectionState(String),
}

pub struct Peer {
    pc: Arc<RTCPeerConnection>,
    pub local_track: Arc<TrackLocalStaticRTP>,
}

impl Peer {
    /// Create a new peer connection. Returns the Peer and a receiver for events.
    pub async fn new() -> Result<(Self, mpsc::UnboundedReceiver<PeerEvent>), Box<dyn std::error::Error + Send + Sync>> {
        // Media engine with Opus codec matching Go SFU exactly
        let mut media_engine = MediaEngine::default();
        media_engine.register_codec(
            RTCRtpCodecParameters {
                capability: RTCRtpCodecCapability {
                    mime_type: "audio/opus".to_string(),
                    clock_rate: 48000,
                    channels: 2,
                    sdp_fmtp_line: "minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=128000"
                        .to_string(),
                    ..Default::default()
                },
                payload_type: 111,
                ..Default::default()
            },
            RTPCodecType::Audio,
        )?;

        // Interceptors: NACK for packet loss recovery
        let mut registry = Registry::new();
        registry = register_default_interceptors(registry, &mut media_engine)?;

        let api = APIBuilder::new()
            .with_media_engine(media_engine)
            .with_interceptor_registry(registry)
            .build();

        let config = RTCConfiguration {
            ice_servers: vec![RTCIceServer {
                urls: vec!["stun:stun.l.google.com:19302".to_string()],
                ..Default::default()
            }],
            ..Default::default()
        };

        let pc = Arc::new(api.new_peer_connection(config).await?);

        // Create local audio track for sending mic audio
        let local_track = Arc::new(TrackLocalStaticRTP::new(
            RTCRtpCodecCapability {
                mime_type: "audio/opus".to_string(),
                clock_rate: 48000,
                channels: 2,
                sdp_fmtp_line: "minptime=10;useinbandfec=1;usedtx=1;maxaveragebitrate=128000"
                    .to_string(),
                ..Default::default()
            },
            "audio".to_string(),
            "voice".to_string(),
        ));

        // Add local track to PC
        let rtp_sender = pc
            .add_track(Arc::clone(&local_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await?;

        // Read RTCP packets (required by webrtc-rs to avoid blocking)
        tokio::spawn(async move {
            let mut buf = vec![0u8; 1500];
            while rtp_sender.read(&mut buf).await.is_ok() {}
        });

        // Set up event channel
        let (event_tx, event_rx) = mpsc::unbounded_channel();

        // ICE candidate handler
        let tx = event_tx.clone();
        pc.on_ice_candidate(Box::new(move |candidate| {
            let tx = tx.clone();
            Box::pin(async move {
                if let Some(c) = candidate {
                    let json = c.to_json().expect("ice candidate to_json");
                    let _ = tx.send(PeerEvent::IceCandidate(IceCandidateOut {
                        candidate: json.candidate,
                        sdp_mid: json.sdp_mid,
                        sdp_mline_index: json.sdp_mline_index,
                    }));
                }
            })
        }));

        // Remote track handler
        let tx = event_tx.clone();
        pc.on_track(Box::new(move |track, _receiver, _transceiver| {
            let tx = tx.clone();
            Box::pin(async move {
                log::info!("Remote track received: {}", track.codec().capability.mime_type);
                let _ = tx.send(PeerEvent::RemoteTrack(track));
            })
        }));

        // Connection state handler
        let tx = event_tx;
        pc.on_peer_connection_state_change(Box::new(move |state| {
            let tx = tx.clone();
            Box::pin(async move {
                let state_str = format!("{:?}", state).to_lowercase();
                log::info!("PeerConnection state: {}", state_str);
                let _ = tx.send(PeerEvent::ConnectionState(state_str));
            })
        }));

        Ok((Self { pc, local_track }, event_rx))
    }

    /// Process an SDP offer from the server and return our answer.
    pub async fn handle_offer(&self, sdp: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let offer = RTCSessionDescription::offer(sdp.to_string())?;
        self.pc.set_remote_description(offer).await?;

        let answer = self.pc.create_answer(None).await?;
        self.pc.set_local_description(answer).await?;

        let local_desc = self
            .pc
            .local_description()
            .await
            .ok_or("no local description")?;

        Ok(local_desc.sdp)
    }

    /// Add a remote ICE candidate.
    pub async fn handle_ice(&self, candidate: IceCandidateIn) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let init = RTCIceCandidateInit {
            candidate: candidate.candidate,
            sdp_mid: candidate.sdp_mid,
            sdp_mline_index: candidate.sdp_mline_index,
            ..Default::default()
        };
        self.pc.add_ice_candidate(init).await?;
        Ok(())
    }

    /// Close the peer connection.
    pub async fn close(self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        self.pc.close().await?;
        Ok(())
    }
}
