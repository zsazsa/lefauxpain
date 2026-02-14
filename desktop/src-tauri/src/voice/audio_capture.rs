use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleRate, StreamConfig};
use ringbuf::{HeapRb, traits::{Producer, Consumer, Observer, Split}};
use tokio::sync::mpsc;
use webrtc::track::track_local::track_local_static_rtp::TrackLocalStaticRTP;
use webrtc::track::track_local::TrackLocalWriter;

use super::resampler::AudioResampler;
use super::speaking::SpeakingDetector;

const OPUS_SAMPLE_RATE: u32 = 48000;
const OPUS_CHANNELS: usize = 2;
const OPUS_FRAME_MS: usize = 20;
const OPUS_FRAME_SAMPLES: usize = (OPUS_SAMPLE_RATE as usize * OPUS_FRAME_MS) / 1000; // 960

/// Messages from capture to the engine.
pub enum CaptureEvent {
    Speaking(bool),
}

/// Wrapper around cpal::Stream to make it Send+Sync.
/// On Linux (ALSA), the stream handle is thread-safe but cpal marks it
/// !Send as a cross-platform precaution. We only use this on Linux.
struct SendStream(#[allow(dead_code)] cpal::Stream);
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

pub struct AudioCapture {
    stream: Option<SendStream>,
    encode_handle: Option<tokio::task::JoinHandle<()>>,
    muted: Arc<AtomicBool>,
    mic_gain: Arc<std::sync::Mutex<f32>>,
    pub event_rx: Option<mpsc::UnboundedReceiver<CaptureEvent>>,
}

impl AudioCapture {
    pub fn new() -> Self {
        Self {
            stream: None,
            encode_handle: None,
            muted: Arc::new(AtomicBool::new(false)),
            mic_gain: Arc::new(std::sync::Mutex::new(1.0)),
            event_rx: None,
        }
    }

    /// Start capturing from the given device (or default).
    /// Encodes Opus and writes RTP to the provided track.
    pub fn start(
        &mut self,
        device_name: Option<&str>,
        track: Arc<TrackLocalStaticRTP>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let host = cpal::default_host();
        let device = if let Some(name) = device_name {
            host.input_devices()?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                .ok_or_else(|| format!("input device '{}' not found", name))?
        } else {
            host.default_input_device()
                .ok_or("no default input device")?
        };

        let supported = device.default_input_config()?;
        let device_rate = supported.sample_rate().0;
        let device_channels = supported.channels() as usize;

        log::info!(
            "Capture device: {} ({}Hz, {}ch)",
            device.name().unwrap_or_default(),
            device_rate,
            device_channels,
        );

        // Ring buffer: enough for ~200ms of audio at device rate
        let buf_size = (device_rate as usize * device_channels * 200) / 1000;
        let rb = HeapRb::<f32>::new(buf_size.max(8192));
        let (mut producer, mut consumer) = rb.split();

        let mic_gain = Arc::clone(&self.mic_gain);

        // cpal input stream
        let config = StreamConfig {
            channels: device_channels as u16,
            sample_rate: SampleRate(device_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let gain_for_stream = Arc::clone(&mic_gain);
        let stream = device.build_input_stream(
            &config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                let gain = *gain_for_stream.lock().unwrap();
                for &sample in data {
                    let _ = producer.try_push(sample * gain);
                }
            },
            |err| log::error!("cpal input error: {}", err),
            None,
        )?;
        stream.play()?;
        self.stream = Some(SendStream(stream));

        // Event channel for speaking detection
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        self.event_rx = Some(event_rx);

        // Spawn async encode task
        let muted = Arc::clone(&self.muted);
        let handle = tokio::spawn(async move {
            let needs_resample = device_rate != OPUS_SAMPLE_RATE;
            let mut resampler = if needs_resample {
                let input_frames =
                    (OPUS_FRAME_SAMPLES as f64 * device_rate as f64 / OPUS_SAMPLE_RATE as f64)
                        .ceil() as usize;
                Some(AudioResampler::new(
                    device_rate,
                    OPUS_SAMPLE_RATE,
                    input_frames,
                    OPUS_CHANNELS,
                ))
            } else {
                None
            };

            let mut encoder = match opus::Encoder::new(
                OPUS_SAMPLE_RATE,
                opus::Channels::Stereo,
                opus::Application::Voip,
            ) {
                Ok(e) => e,
                Err(e) => {
                    log::error!("Failed to create Opus encoder: {}", e);
                    return;
                }
            };
            let _ = encoder.set_bitrate(opus::Bitrate::Bits(128000));
            let _ = encoder.set_inband_fec(true);
            let _ = encoder.set_dtx(true);

            let mut speaking_detector = SpeakingDetector::new();
            let mut opus_buf = vec![0u8; 4000];
            let mut pcm_buf = Vec::new();

            // How many interleaved samples we need per frame at device rate
            let device_frame_samples = if needs_resample {
                let input_frames =
                    (OPUS_FRAME_SAMPLES as f64 * device_rate as f64 / OPUS_SAMPLE_RATE as f64)
                        .ceil() as usize;
                input_frames * device_channels
            } else {
                OPUS_FRAME_SAMPLES * device_channels
            };

            let mut timestamp: u32 = 0;
            let mut sequence: u16 = 0;

            loop {
                tokio::time::sleep(Duration::from_millis(5)).await;

                // Drain from ring buffer
                while consumer.occupied_len() > 0 {
                    if let Some(sample) = consumer.try_pop() {
                        pcm_buf.push(sample);
                    } else {
                        break;
                    }
                }

                while pcm_buf.len() >= device_frame_samples {
                    let frame: Vec<f32> = pcm_buf.drain(..device_frame_samples).collect();

                    // Convert to stereo at 48kHz
                    let stereo_48k = if needs_resample {
                        let stereo = to_stereo(&frame, device_channels);
                        resampler.as_mut().unwrap().process(&stereo)
                    } else {
                        to_stereo(&frame, device_channels)
                    };

                    // Speaking detection on mono
                    let mono: Vec<f32> = stereo_48k
                        .chunks(2)
                        .map(|c| (c[0] + c.get(1).copied().unwrap_or(c[0])) / 2.0)
                        .collect();
                    if let Some(speaking) = speaking_detector.process(&mono, OPUS_FRAME_MS as f64) {
                        let _ = event_tx.send(CaptureEvent::Speaking(speaking));
                    }

                    if muted.load(Ordering::Relaxed) {
                        timestamp = timestamp.wrapping_add(OPUS_FRAME_SAMPLES as u32);
                        continue;
                    }

                    // Opus encode (expects interleaved i16)
                    let pcm_i16: Vec<i16> = stereo_48k
                        .iter()
                        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
                        .collect();

                    let encoded_len = match encoder.encode(&pcm_i16, &mut opus_buf) {
                        Ok(len) => len,
                        Err(e) => {
                            log::error!("Opus encode error: {}", e);
                            continue;
                        }
                    };

                    let rtp_packet = webrtc::rtp::packet::Packet {
                        header: webrtc::rtp::header::Header {
                            version: 2,
                            padding: false,
                            extension: false,
                            marker: false,
                            payload_type: 111,
                            sequence_number: sequence,
                            timestamp,
                            ssrc: 0,
                            ..Default::default()
                        },
                        payload: bytes::Bytes::copy_from_slice(&opus_buf[..encoded_len]),
                    };

                    sequence = sequence.wrapping_add(1);
                    timestamp = timestamp.wrapping_add(OPUS_FRAME_SAMPLES as u32);

                    if let Err(e) = track.write_rtp(&rtp_packet).await {
                        if e.to_string().contains("closed") {
                            break;
                        }
                        log::error!("RTP write error: {}", e);
                    }
                }
            }
        });
        self.encode_handle = Some(handle);

        Ok(())
    }

    pub fn stop(&mut self) {
        self.stream = None;
        if let Some(handle) = self.encode_handle.take() {
            handle.abort();
        }
        self.event_rx = None;
    }

    pub fn set_muted(&self, muted: bool) {
        self.muted.store(muted, Ordering::Relaxed);
    }

    pub fn set_mic_gain(&self, gain: f32) {
        *self.mic_gain.lock().unwrap() = gain;
    }

    pub fn is_running(&self) -> bool {
        self.stream.is_some()
    }
}

/// Convert any channel count to stereo interleaved.
fn to_stereo(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels == 2 {
        return samples.to_vec();
    }
    if channels == 1 {
        let mut stereo = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            stereo.push(s);
            stereo.push(s);
        }
        return stereo;
    }
    // Multi-channel → take first two
    let frames = samples.len() / channels;
    let mut stereo = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        stereo.push(samples[i * channels]);
        stereo.push(samples[i * channels + 1]);
    }
    stereo
}

/// List available input devices.
pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

/// List available output devices.
pub fn list_output_devices() -> Vec<String> {
    let host = cpal::default_host();
    host.output_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}
