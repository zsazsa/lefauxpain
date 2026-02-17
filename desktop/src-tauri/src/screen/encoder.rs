use openh264::encoder::{Encoder, EncoderConfig, RateControlMode, UsageType};
use openh264::formats::YUVBuffer;
use openh264::OpenH264API;

pub struct FrameData {
    pub data: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub is_bgra: bool,
}

pub trait ScreenEncoder {
    /// Encode a frame. Returns H.264 NAL units (Annex B).
    fn encode(&mut self, frame: &FrameData) -> Result<Vec<u8>, Box<dyn std::error::Error>>;

    /// Force next frame to be an IDR keyframe.
    fn force_keyframe(&mut self);
}

struct SoftwareEncoder {
    encoder: Encoder,
    width: usize,
    height: usize,
}

impl SoftwareEncoder {
    fn new(width: u32, height: u32, bitrate_kbps: u32) -> Result<Self, Box<dyn std::error::Error>> {
        let config = EncoderConfig::new()
            .set_bitrate_bps(bitrate_kbps * 1000)
            .usage_type(UsageType::ScreenContentRealTime)
            .max_frame_rate(60.0)
            .enable_skip_frame(false)
            .rate_control_mode(RateControlMode::Bitrate);
        let encoder = Encoder::with_api_config(OpenH264API::from_source(), config)?;
        Ok(Self {
            encoder,
            width: width as usize,
            height: height as usize,
        })
    }
}

impl ScreenEncoder for SoftwareEncoder {
    fn encode(&mut self, frame: &FrameData) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let fw = frame.width as usize;
        let fh = frame.height as usize;

        let i420 = if frame.is_bgra {
            bgra_to_i420(&frame.data, fw, fh)
        } else {
            rgba_to_i420(&frame.data, fw, fh)
        };

        let yuv = YUVBuffer::from_vec(i420, self.width, self.height);
        let bitstream = self.encoder.encode(&yuv)?;
        Ok(bitstream.to_vec())
    }

    fn force_keyframe(&mut self) {
        self.encoder.force_intra_frame();
    }
}

pub fn create_encoder(
    width: u32,
    height: u32,
    bitrate_kbps: u32,
) -> Result<Box<dyn ScreenEncoder>, Box<dyn std::error::Error>> {
    #[cfg(feature = "nvenc")]
    {
        if let Some(enc) = super::nvenc::NvencEncoder::try_new(width, height, bitrate_kbps) {
            return Ok(Box::new(enc));
        }
    }
    #[cfg(feature = "vaapi")]
    {
        if let Some(enc) = super::vaapi::VaapiEncoder::try_new(width, height, bitrate_kbps) {
            return Ok(Box::new(enc));
        }
    }
    eprintln!("[screen] Using software encoder (openh264)");
    Ok(Box::new(SoftwareEncoder::new(width, height, bitrate_kbps)?))
}

/// Convert BGRA pixels to I420 (YUV420p) using fixed-point BT.601 coefficients.
/// Integer math avoids float ops — ~3-5x faster than the float version.
fn bgra_to_i420(bgra: &[u8], width: usize, height: usize) -> Vec<u8> {
    let y_size = width * height;
    let uv_width = width / 2;
    let uv_height = height / 2;
    let uv_size = uv_width * uv_height;

    let mut yuv = vec![0u8; y_size + uv_size * 2];
    let (y_plane, uv_planes) = yuv.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_size);

    // Y plane: one sample per pixel
    for row in 0..height {
        let row_off = row * width;
        for col in 0..width {
            let px = (row_off + col) * 4;
            let b = bgra[px] as i32;
            let g = bgra[px + 1] as i32;
            let r = bgra[px + 2] as i32;
            // Y = 16 + (66*R + 129*G + 25*B + 128) >> 8
            y_plane[row_off + col] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8;
        }
    }

    // U/V planes: 2x2 subsampled
    for row in 0..uv_height {
        let src_row = row * 2;
        let uv_off = row * uv_width;
        for col in 0..uv_width {
            let src_col = col * 2;
            let mut r_sum = 0i32;
            let mut g_sum = 0i32;
            let mut b_sum = 0i32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let px = ((src_row + dy) * width + (src_col + dx)) * 4;
                    b_sum += bgra[px] as i32;
                    g_sum += bgra[px + 1] as i32;
                    r_sum += bgra[px + 2] as i32;
                }
            }
            // Average the 2x2 block (>> 2)
            let r = r_sum >> 2;
            let g = g_sum >> 2;
            let b = b_sum >> 2;
            // U = 128 + (-38*R - 74*G + 112*B + 128) >> 8
            u_plane[uv_off + col] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            // V = 128 + (112*R - 94*G - 18*B + 128) >> 8
            v_plane[uv_off + col] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }

    yuv
}

/// Convert RGBA pixels to I420 (YUV420p) using fixed-point BT.601 coefficients.
fn rgba_to_i420(rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    let y_size = width * height;
    let uv_width = width / 2;
    let uv_height = height / 2;
    let uv_size = uv_width * uv_height;

    let mut yuv = vec![0u8; y_size + uv_size * 2];
    let (y_plane, uv_planes) = yuv.split_at_mut(y_size);
    let (u_plane, v_plane) = uv_planes.split_at_mut(uv_size);

    for row in 0..height {
        let row_off = row * width;
        for col in 0..width {
            let px = (row_off + col) * 4;
            let r = rgba[px] as i32;
            let g = rgba[px + 1] as i32;
            let b = rgba[px + 2] as i32;
            y_plane[row_off + col] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) as u8;
        }
    }

    for row in 0..uv_height {
        let src_row = row * 2;
        let uv_off = row * uv_width;
        for col in 0..uv_width {
            let src_col = col * 2;
            let mut r_sum = 0i32;
            let mut g_sum = 0i32;
            let mut b_sum = 0i32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let px = ((src_row + dy) * width + (src_col + dx)) * 4;
                    r_sum += rgba[px] as i32;
                    g_sum += rgba[px + 1] as i32;
                    b_sum += rgba[px + 2] as i32;
                }
            }
            let r = r_sum >> 2;
            let g = g_sum >> 2;
            let b = b_sum >> 2;
            u_plane[uv_off + col] = (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128) as u8;
            v_plane[uv_off + col] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128) as u8;
        }
    }

    yuv
}
