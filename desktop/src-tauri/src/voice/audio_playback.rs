use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleRate, StreamConfig};
use ringbuf::{HeapRb, traits::{Consumer, Split}};

const OPUS_SAMPLE_RATE: u32 = 48000;
const OPUS_CHANNELS: usize = 2;

/// Wrapper around cpal::Stream to make it Send+Sync.
struct SendStream(#[allow(dead_code)] cpal::Stream);
unsafe impl Send for SendStream {}
unsafe impl Sync for SendStream {}

pub struct AudioPlayback {
    stream: Option<SendStream>,
    decode_handles: Vec<tokio::task::JoinHandle<()>>,
    pub deafened: Arc<AtomicBool>,
    pub master_volume: Arc<std::sync::Mutex<f32>>,
    /// Shared producer for all decode tasks to write mixed audio into.
    pub mix_producer: Arc<std::sync::Mutex<Option<ringbuf::HeapProd<f32>>>>,
    pub device_rate: u32,
    pub device_channels: usize,
}

impl AudioPlayback {
    pub fn new() -> Self {
        Self {
            stream: None,
            decode_handles: Vec::new(),
            deafened: Arc::new(AtomicBool::new(false)),
            master_volume: Arc::new(std::sync::Mutex::new(1.0)),
            mix_producer: Arc::new(std::sync::Mutex::new(None)),
            device_rate: OPUS_SAMPLE_RATE,
            device_channels: OPUS_CHANNELS,
        }
    }

    /// Start the output stream on the given device (or default).
    pub fn start(
        &mut self,
        device_name: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let host = cpal::default_host();
        let device = if let Some(name) = device_name {
            host.output_devices()?
                .find(|d| d.name().map(|n| n == name).unwrap_or(false))
                .ok_or_else(|| format!("output device '{}' not found", name))?
        } else {
            host.default_output_device()
                .ok_or("no default output device")?
        };

        let supported = device.default_output_config()?;
        self.device_rate = supported.sample_rate().0;
        self.device_channels = supported.channels() as usize;

        log::info!(
            "Playback device: {} ({}Hz, {}ch)",
            device.name().unwrap_or_default(),
            self.device_rate,
            self.device_channels,
        );

        // Ring buffer: ~500ms of audio at device rate
        let buf_size = (self.device_rate as usize * self.device_channels * 500) / 1000;
        let rb = HeapRb::<f32>::new(buf_size.max(16384));
        let (producer, mut consumer) = rb.split();

        // Store producer for decode tasks
        *self.mix_producer.lock().unwrap() = Some(producer);

        let deafened = Arc::clone(&self.deafened);
        let volume = Arc::clone(&self.master_volume);

        let config = StreamConfig {
            channels: self.device_channels as u16,
            sample_rate: SampleRate(self.device_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let vol = *volume.lock().unwrap();
                let deaf = deafened.load(Ordering::Relaxed);

                for sample in data.iter_mut() {
                    *sample = if deaf {
                        0.0
                    } else if let Some(s) = consumer.try_pop() {
                        s * vol
                    } else {
                        0.0
                    };
                }
            },
            |err| log::error!("cpal output error: {}", err),
            None,
        )?;
        stream.play()?;
        self.stream = Some(SendStream(stream));

        Ok(())
    }

    pub fn stop(&mut self) {
        self.stream = None;
        for handle in self.decode_handles.drain(..) {
            handle.abort();
        }
        *self.mix_producer.lock().unwrap() = None;
    }

    pub fn set_deafened(&self, deafened: bool) {
        self.deafened.store(deafened, Ordering::Relaxed);
    }

    pub fn set_master_volume(&self, volume: f32) {
        *self.master_volume.lock().unwrap() = volume;
    }

    pub fn is_running(&self) -> bool {
        self.stream.is_some()
    }
}

/// Adapt between different channel counts.
pub fn adapt_channels(samples: &[f32], from_ch: usize, to_ch: usize) -> Vec<f32> {
    if from_ch == to_ch {
        return samples.to_vec();
    }
    let frames = samples.len() / from_ch;
    let mut out = Vec::with_capacity(frames * to_ch);
    for i in 0..frames {
        if to_ch == 1 {
            let mut sum = 0.0;
            for c in 0..from_ch {
                sum += samples[i * from_ch + c];
            }
            out.push(sum / from_ch as f32);
        } else {
            for c in 0..to_ch {
                if c < from_ch {
                    out.push(samples[i * from_ch + c]);
                } else {
                    out.push(samples[i * from_ch]);
                }
            }
        }
    }
    out
}
