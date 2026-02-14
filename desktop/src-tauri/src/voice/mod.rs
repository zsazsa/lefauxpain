pub mod audio_capture;
pub mod audio_playback;
pub mod peer;
pub mod resampler;
pub mod speaking;
pub mod types;

use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use audio_capture::{AudioCapture, CaptureEvent};
use audio_playback::AudioPlayback;
use peer::{Peer, PeerEvent};
use types::*;

/// Central voice engine — held as Tauri managed state behind Arc<Mutex<>>.
pub struct VoiceEngine {
    peer: Option<Peer>,
    capture: AudioCapture,
    playback: AudioPlayback,
    input_device: Option<String>,
    output_device: Option<String>,
    event_handle: Option<tokio::task::JoinHandle<()>>,
}

impl VoiceEngine {
    pub fn new() -> Self {
        Self {
            peer: None,
            capture: AudioCapture::new(),
            playback: AudioPlayback::new(),
            input_device: None,
            output_device: None,
            event_handle: None,
        }
    }

    /// Start playback output stream.
    fn start_playback(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.playback.is_running() {
            self.playback.start(self.output_device.as_deref())?;
        }
        Ok(())
    }

    /// Create peer connection, start capture, and begin event forwarding.
    async fn ensure_peer(
        &mut self,
        app: &AppHandle,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if self.peer.is_some() {
            return Ok(());
        }

        self.start_playback()?;

        let (peer, peer_rx) = Peer::new().await?;

        // Start mic capture, writing RTP to the peer's local track
        self.capture
            .start(self.input_device.as_deref(), Arc::clone(&peer.local_track))?;

        // Take capture speaking events
        let capture_rx = self.capture.event_rx.take();

        // Clone the mix_producer arc so decode tasks can write to playback
        let mix_producer = Arc::clone(&self.playback.mix_producer);
        let device_rate = self.playback.device_rate;
        let device_channels = self.playback.device_channels;

        // Spawn event forwarding: peer events + speaking → frontend
        let app_handle = app.clone();
        let event_handle = tokio::spawn(async move {
            run_event_loop(app_handle, peer_rx, capture_rx, mix_producer, device_rate, device_channels).await;
        });
        self.event_handle = Some(event_handle);
        self.peer = Some(peer);
        Ok(())
    }

    fn stop(&mut self) {
        self.capture.stop();
        self.playback.stop();
        if let Some(handle) = self.event_handle.take() {
            handle.abort();
        }
        if let Some(peer) = self.peer.take() {
            tokio::spawn(async move {
                let _ = peer.close().await;
            });
        }
        log::info!("Voice engine stopped");
    }
}

/// Event forwarding loop: peer events + capture speaking → frontend.
/// Remote tracks get decoded and written to the mix buffer.
async fn run_event_loop(
    app: AppHandle,
    mut peer_rx: tokio::sync::mpsc::UnboundedReceiver<PeerEvent>,
    mut capture_rx: Option<tokio::sync::mpsc::UnboundedReceiver<CaptureEvent>>,
    mix_producer: Arc<std::sync::Mutex<Option<ringbuf::HeapProd<f32>>>>,
    device_rate: u32,
    device_channels: usize,
) {
    loop {
        tokio::select! {
            Some(event) = peer_rx.recv() => {
                match event {
                    PeerEvent::IceCandidate(candidate) => {
                        let _ = app.emit("voice:ice_candidate", &candidate);
                    }
                    PeerEvent::RemoteTrack(track) => {
                        log::info!("Remote track received, spawning decode task");
                        spawn_decode_task(
                            track,
                            Arc::clone(&mix_producer),
                            device_rate,
                            device_channels,
                        );
                    }
                    PeerEvent::ConnectionState(state) => {
                        let _ = app.emit(
                            "voice:connection_state",
                            &ConnectionStateEvent { state },
                        );
                    }
                }
            }
            Some(event) = async {
                match capture_rx.as_mut() {
                    Some(rx) => rx.recv().await,
                    None => std::future::pending().await,
                }
            } => {
                match event {
                    CaptureEvent::Speaking(speaking) => {
                        let _ = app.emit(
                            "voice:speaking",
                            &SpeakingEvent { speaking },
                        );
                    }
                }
            }
            else => break,
        }
    }
}

/// Spawn a decode task for a single remote track.
fn spawn_decode_task(
    track: Arc<webrtc::track::track_remote::TrackRemote>,
    mix_producer: Arc<std::sync::Mutex<Option<ringbuf::HeapProd<f32>>>>,
    device_rate: u32,
    device_channels: usize,
) {
    tokio::spawn(async move {
        use ringbuf::traits::Producer;
        let mut decoder = match opus::Decoder::new(48000, opus::Channels::Stereo) {
            Ok(d) => d,
            Err(e) => {
                log::error!("Failed to create Opus decoder: {}", e);
                return;
            }
        };

        let needs_resample = device_rate != 48000;
        let mut resampler = if needs_resample {
            Some(resampler::AudioResampler::new(48000, device_rate, 960, 2))
        } else {
            None
        };

        let mut pcm_buf = vec![0i16; 960 * 2];
        let mut rtp_buf = vec![0u8; 4000];

        loop {
            // track.read returns (Packet, Attributes) directly
            let (packet, _attrs) = match track.read(&mut rtp_buf).await {
                Ok(r) => r,
                Err(e) => {
                    if e.to_string().contains("closed") {
                        break;
                    }
                    log::error!("Remote track read error: {}", e);
                    break;
                }
            };

            if packet.payload.is_empty() {
                continue;
            }

            let decoded = match decoder.decode(&packet.payload, &mut pcm_buf, false) {
                Ok(n) => n,
                Err(e) => {
                    log::error!("Opus decode error: {}", e);
                    continue;
                }
            };

            // i16 → f32
            let mut f32_samples: Vec<f32> = pcm_buf[..decoded * 2]
                .iter()
                .map(|&s| s as f32 / 32768.0)
                .collect();

            // Resample if needed
            if let Some(ref mut rs) = resampler {
                f32_samples = rs.process(&f32_samples);
            }

            // Adapt channels
            let output = audio_playback::adapt_channels(&f32_samples, 2, device_channels);

            // Write to ring buffer
            if let Ok(mut guard) = mix_producer.lock() {
                if let Some(ref mut prod) = *guard {
                    for &sample in &output {
                        let _ = prod.try_push(sample);
                    }
                }
            }
        }

        log::info!("Remote track decode task ended");
    });
}

// ── Tauri Commands ──────────────────────────────────────────────────────

pub type VoiceState = Arc<Mutex<VoiceEngine>>;

#[tauri::command]
pub async fn voice_start(
    _app: AppHandle,
    state: tauri::State<'_, VoiceState>,
) -> Result<(), String> {
    let mut engine = state.inner().lock().await;
    engine.start_playback().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn voice_stop(state: tauri::State<'_, VoiceState>) -> Result<(), String> {
    let mut engine = state.inner().lock().await;
    engine.stop();
    Ok(())
}

#[tauri::command]
pub async fn voice_handle_offer(
    app: AppHandle,
    state: tauri::State<'_, VoiceState>,
    sdp: String,
) -> Result<SdpAnswer, String> {
    let mut engine = state.inner().lock().await;
    engine.ensure_peer(&app).await.map_err(|e| e.to_string())?;

    let peer = engine.peer.as_ref().unwrap();
    let answer_sdp = peer.handle_offer(&sdp).await.map_err(|e| e.to_string())?;
    Ok(SdpAnswer { sdp: answer_sdp })
}

#[tauri::command]
pub async fn voice_handle_ice(
    state: tauri::State<'_, VoiceState>,
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
        Err("no peer connection".to_string())
    }
}

#[tauri::command]
pub async fn voice_set_mute(
    state: tauri::State<'_, VoiceState>,
    muted: bool,
) -> Result<(), String> {
    let engine = state.inner().lock().await;
    engine.capture.set_muted(muted);
    Ok(())
}

#[tauri::command]
pub async fn voice_set_deafen(
    state: tauri::State<'_, VoiceState>,
    deafened: bool,
) -> Result<(), String> {
    let engine = state.inner().lock().await;
    engine.playback.set_deafened(deafened);
    Ok(())
}

#[tauri::command]
pub async fn voice_set_master_volume(
    state: tauri::State<'_, VoiceState>,
    volume: f32,
) -> Result<(), String> {
    let engine = state.inner().lock().await;
    engine.playback.set_master_volume(volume);
    Ok(())
}

#[tauri::command]
pub async fn voice_set_mic_gain(
    state: tauri::State<'_, VoiceState>,
    gain: f32,
) -> Result<(), String> {
    let engine = state.inner().lock().await;
    engine.capture.set_mic_gain(gain);
    Ok(())
}

#[tauri::command]
pub async fn voice_list_devices() -> Result<AudioDeviceList, String> {
    let inputs = audio_capture::list_input_devices()
        .into_iter()
        .map(|name| AudioDeviceInfo {
            is_default: false,
            name,
        })
        .collect();
    let outputs = audio_capture::list_output_devices()
        .into_iter()
        .map(|name| AudioDeviceInfo {
            is_default: false,
            name,
        })
        .collect();
    Ok(AudioDeviceList { inputs, outputs })
}

#[tauri::command]
pub async fn voice_set_input_device(
    state: tauri::State<'_, VoiceState>,
    device_name: String,
) -> Result<(), String> {
    let mut engine = state.inner().lock().await;
    engine.input_device = Some(device_name);
    if engine.capture.is_running() {
        if let Some(peer) = &engine.peer {
            let track = Arc::clone(&peer.local_track);
            let device = engine.input_device.as_deref().map(|s| s.to_string());
            engine.capture.stop();
            engine
                .capture
                .start(device.as_deref(), track)
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_set_output_device(
    state: tauri::State<'_, VoiceState>,
    device_name: String,
) -> Result<(), String> {
    let mut engine = state.inner().lock().await;
    engine.output_device = Some(device_name);
    if engine.playback.is_running() {
        let device = engine.output_device.as_deref().map(|s| s.to_string());
        engine.playback.stop();
        engine
            .playback
            .start(device.as_deref())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
