pub mod capture;
pub mod encoder;
pub mod peer;
pub mod preview;

use std::sync::Arc;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use capture::ScreenCapture;
use peer::{ScreenPeer, ScreenPeerEvent};
use preview::MjpegServer;
use crate::voice::types::*;

pub struct ScreenEngine {
    peer: Option<ScreenPeer>,
    capture: ScreenCapture,
    event_handle: Option<tokio::task::JoinHandle<()>>,
    mjpeg_server: Option<MjpegServer>,
}

impl ScreenEngine {
    pub fn new() -> Self {
        Self {
            peer: None,
            capture: ScreenCapture::new(),
            event_handle: None,
            mjpeg_server: None,
        }
    }

    fn stop(&mut self) {
        self.capture.stop();
        if let Some(server) = self.mjpeg_server.take() {
            server.stop();
        }
        if let Some(handle) = self.event_handle.take() {
            handle.abort();
        }
        if let Some(peer) = self.peer.take() {
            tokio::spawn(async move {
                let _ = peer.close().await;
            });
        }
        log::info!("[screen] Screen engine stopped");
    }
}

pub type ScreenState = Arc<Mutex<ScreenEngine>>;

#[derive(Serialize)]
pub struct ScreenStartResult {
    pub preview_port: u16,
}

#[tauri::command]
pub async fn screen_start(
    app: AppHandle,
    state: tauri::State<'_, ScreenState>,
) -> Result<ScreenStartResult, String> {
    // Stop any existing session
    {
        let mut engine = state.inner().lock().await;
        engine.stop();
    } // drop lock before portal (portal shows a picker dialog)

    // Run portal FIRST — if the user cancels, we return an error and the
    // frontend never sets isPresenting/sends screen_share_start.
    let portal = capture::portal_start_screencast()
        .await
        .map_err(|e| e.to_string())?;

    // Re-acquire lock for the rest of setup
    let mut engine = state.inner().lock().await;

    // Create watch channel for preview frames
    let (preview_tx, preview_rx) = tokio::sync::watch::channel(None);

    // Start MJPEG server
    let mjpeg_server = MjpegServer::start(preview_rx)
        .await
        .map_err(|e| e.to_string())?;
    let preview_port = mjpeg_server.port();
    engine.mjpeg_server = Some(mjpeg_server);

    // Create peer and start capture
    let (peer, peer_rx) = ScreenPeer::new().await.map_err(|e| e.to_string())?;
    let video_track = Arc::clone(&peer.video_track);
    let audio_track = Arc::clone(&peer.audio_track);

    engine.capture.start(video_track, audio_track, preview_tx, portal);

    // Spawn event forwarding loop
    let app_handle = app.clone();
    let event_handle = tokio::spawn(async move {
        run_event_loop(app_handle, peer_rx).await;
    });
    engine.event_handle = Some(event_handle);
    engine.peer = Some(peer);

    eprintln!("[screen] Screen engine started (preview port: {})", preview_port);
    Ok(ScreenStartResult { preview_port })
}

#[tauri::command]
pub async fn screen_stop(state: tauri::State<'_, ScreenState>) -> Result<(), String> {
    let mut engine = state.inner().lock().await;
    engine.stop();
    Ok(())
}

#[tauri::command]
pub async fn screen_handle_offer(
    _app: AppHandle,
    state: tauri::State<'_, ScreenState>,
    sdp: String,
) -> Result<SdpAnswer, String> {
    let engine = state.inner().lock().await;
    let peer = engine.peer.as_ref().ok_or("no screen peer")?;
    let answer_sdp = peer.handle_offer(&sdp).await.map_err(|e| e.to_string())?;
    Ok(SdpAnswer { sdp: answer_sdp })
}

#[tauri::command]
pub async fn screen_handle_ice(
    state: tauri::State<'_, ScreenState>,
    candidate: String,
    sdp_mid: Option<String>,
    sdp_mline_index: Option<u16>,
) -> Result<(), String> {
    let engine = state.inner().lock().await;
    if let Some(peer) = &engine.peer {
        peer.handle_ice(IceCandidateIn {
            candidate,
            sdp_mid,
            sdp_mline_index,
        })
        .await
        .map_err(|e| e.to_string())
    } else {
        Err("no screen peer connection".to_string())
    }
}

async fn run_event_loop(
    app: AppHandle,
    mut peer_rx: tokio::sync::mpsc::UnboundedReceiver<ScreenPeerEvent>,
) {
    while let Some(event) = peer_rx.recv().await {
        match event {
            ScreenPeerEvent::IceCandidate(candidate) => {
                let _ = app.emit("screen:ice_candidate", &candidate);
            }
            ScreenPeerEvent::ConnectionState(state) => {
                log::info!("[screen] Connection state: {}", state);
                if state == "failed" || state == "closed" {
                    break;
                }
            }
        }
    }
    log::info!("[screen] Event loop ended");
}
