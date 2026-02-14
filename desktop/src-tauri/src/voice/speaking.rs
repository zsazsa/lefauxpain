/// Speaking detection using RMS energy + EMA smoothing + hold timer.
/// Port of the JS algorithm in client/src/lib/devices.ts.

const SPEAK_THRESHOLD: f32 = 0.015;
const EMA_ATTACK: f32 = 0.4;
const EMA_RELEASE: f32 = 0.05;
const HOLD_MS: f64 = 250.0;

pub struct SpeakingDetector {
    smoothed_rms: f32,
    was_speaking: bool,
    hold_until: f64, // milliseconds (monotonic)
    clock_ms: f64,   // accumulated time from frames
}

impl SpeakingDetector {
    pub fn new() -> Self {
        Self {
            smoothed_rms: 0.0,
            was_speaking: false,
            hold_until: 0.0,
            clock_ms: 0.0,
        }
    }

    /// Process a frame of PCM samples (f32, -1..1).
    /// `frame_duration_ms` is the duration of this frame in milliseconds.
    /// Returns `Some(speaking)` if state changed, None otherwise.
    pub fn process(&mut self, samples: &[f32], frame_duration_ms: f64) -> Option<bool> {
        if samples.is_empty() {
            return None;
        }

        self.clock_ms += frame_duration_ms;

        // Compute RMS
        let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
        let rms = (sum_sq / samples.len() as f32).sqrt();

        // EMA smoothing
        let alpha = if rms > self.smoothed_rms {
            EMA_ATTACK
        } else {
            EMA_RELEASE
        };
        self.smoothed_rms = alpha * rms + (1.0 - alpha) * self.smoothed_rms;

        let is_speaking = if self.smoothed_rms > SPEAK_THRESHOLD {
            self.hold_until = self.clock_ms + HOLD_MS;
            true
        } else if self.clock_ms < self.hold_until {
            true
        } else {
            false
        };

        if is_speaking != self.was_speaking {
            self.was_speaking = is_speaking;
            Some(is_speaking)
        } else {
            None
        }
    }

    #[allow(dead_code)]
    pub fn reset(&mut self) {
        self.smoothed_rms = 0.0;
        self.was_speaking = false;
        self.hold_until = 0.0;
        self.clock_ms = 0.0;
    }
}
