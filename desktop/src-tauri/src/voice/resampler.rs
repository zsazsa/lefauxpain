use rubato::{FftFixedIn, Resampler};

/// Wraps rubato to convert between device sample rate and 48kHz (Opus native).
pub struct AudioResampler {
    resampler: FftFixedIn<f32>,
    input_frames: usize,
    channels: usize,
}

impl AudioResampler {
    /// Create a resampler that converts `from_rate` → `to_rate`.
    /// `chunk_size` is the number of frames per input chunk.
    pub fn new(from_rate: u32, to_rate: u32, chunk_size: usize, channels: usize) -> Self {
        let resampler = FftFixedIn::new(
            from_rate as usize,
            to_rate as usize,
            chunk_size,
            1, // sub_chunks
            channels,
        )
        .expect("failed to create resampler");

        Self {
            resampler,
            input_frames: chunk_size,
            channels,
        }
    }

    /// Resample a chunk of interleaved f32 samples.
    /// Returns resampled interleaved samples.
    pub fn process(&mut self, interleaved: &[f32]) -> Vec<f32> {
        let frames = interleaved.len() / self.channels;

        // De-interleave into per-channel vecs
        let mut channels: Vec<Vec<f32>> = (0..self.channels).map(|_| Vec::with_capacity(frames)).collect();
        for (i, sample) in interleaved.iter().enumerate() {
            channels[i % self.channels].push(*sample);
        }

        // Pad to expected input size if needed
        for ch in &mut channels {
            ch.resize(self.input_frames, 0.0);
        }

        let output = self.resampler.process(&channels, None).expect("resample failed");

        // Re-interleave
        let out_frames = output[0].len();
        let mut result = Vec::with_capacity(out_frames * self.channels);
        for i in 0..out_frames {
            for ch in &output {
                result.push(ch[i]);
            }
        }
        result
    }
}
