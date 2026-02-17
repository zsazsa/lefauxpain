use std::mem::ManuallyDrop;
use std::sync::Arc;

use cudarc::driver::CudaContext;
use nvidia_video_codec_sdk::safe::{
    Buffer, Bitstream, Encoder, EncoderInitParams, EncodePictureParams, EncoderInput, Session,
};
use nvidia_video_codec_sdk::sys::nvEncodeAPI::*;

use super::encoder::{FrameData, ScreenEncoder};

pub struct NvencEncoder {
    // SAFETY: input_buffer and output_bitstream hold a reference to the Encoder
    // inside the Box<Session>. Box keeps it at a stable heap address across moves.
    // ManuallyDrop + custom Drop ensures buffers are dropped BEFORE session.
    input_buffer: ManuallyDrop<Buffer<'static>>,
    output_bitstream: ManuallyDrop<Bitstream<'static>>,
    session: ManuallyDrop<Box<Session>>,
    width: u32,
    height: u32,
    pitch: u32,
    _cuda_ctx: Arc<CudaContext>,
}

impl Drop for NvencEncoder {
    fn drop(&mut self) {
        // Drop buffers before session to maintain borrow validity
        unsafe {
            ManuallyDrop::drop(&mut self.input_buffer);
            ManuallyDrop::drop(&mut self.output_bitstream);
            ManuallyDrop::drop(&mut self.session);
        }
    }
}

impl NvencEncoder {
    pub fn try_new(width: u32, height: u32, bitrate_kbps: u32) -> Option<Self> {
        // Initialize CUDA on device 0
        let cuda_ctx = CudaContext::new(0)
            .map_err(|e| eprintln!("[screen] NVENC: CUDA init failed: {:?}", e))
            .ok()?;

        // Create NVENC encoder backed by CUDA
        let encoder = Encoder::initialize_with_cuda(cuda_ctx.clone())
            .map_err(|e| eprintln!("[screen] NVENC: encoder init failed: {:?}", e))
            .ok()?;

        // Configure H.264 with P4 preset and ultra-low-latency tuning
        let encode_guid = NV_ENC_CODEC_H264_GUID;
        let preset_guid = NV_ENC_PRESET_P4_GUID;
        let tuning = NV_ENC_TUNING_INFO::NV_ENC_TUNING_INFO_ULTRA_LOW_LATENCY;

        let mut preset_config = encoder
            .get_preset_config(encode_guid, preset_guid, tuning)
            .map_err(|e| eprintln!("[screen] NVENC: preset config failed: {:?}", e))
            .ok()?;

        // Set CBR rate control, GOP length, and H.264 settings
        let bitrate = bitrate_kbps * 1000;
        unsafe {
            let config = &mut preset_config.presetCfg;
            config.gopLength = 60;
            config.frameIntervalP = 1;

            config.rcParams.rateControlMode = NV_ENC_PARAMS_RC_MODE::NV_ENC_PARAMS_RC_CBR;
            config.rcParams.averageBitRate = bitrate;
            config.rcParams.maxBitRate = bitrate;
            config.rcParams.vbvBufferSize = bitrate / 60; // 1-frame VBV buffer
            config.rcParams.vbvInitialDelay = config.rcParams.vbvBufferSize;

            let h264 = &mut config.encodeCodecConfig.h264Config;
            h264.idrPeriod = config.gopLength;
            h264.set_repeatSPSPPS(1);
        }

        // Build initialization params
        let mut init_params = EncoderInitParams::new(encode_guid, width, height);
        init_params
            .preset_guid(preset_guid)
            .tuning_info(tuning)
            .framerate(60, 1)
            .enable_picture_type_decision()
            .encode_config(&mut preset_config.presetCfg);

        // Start encoding session with ARGB format (= BGRA byte order on LE)
        let buffer_format = NV_ENC_BUFFER_FORMAT::NV_ENC_BUFFER_FORMAT_ARGB;
        let session = encoder
            .start_session(buffer_format, init_params)
            .map_err(|e| eprintln!("[screen] NVENC: start session failed: {:?}", e))
            .ok()?;

        // Box the session so it lives at a stable heap address. Buffer and
        // Bitstream hold a reference to the Encoder inside Session — boxing
        // ensures that reference remains valid when the struct is moved.
        let session = Box::new(session);

        // Pre-allocate input buffer and output bitstream (reused across frames)
        let mut input_buffer = session
            .create_input_buffer()
            .map_err(|e| eprintln!("[screen] NVENC: create input buffer failed: {:?}", e))
            .ok()?;
        let output_bitstream = session
            .create_output_bitstream()
            .map_err(|e| eprintln!("[screen] NVENC: create output bitstream failed: {:?}", e))
            .ok()?;

        // Discover the actual byte pitch via a lock/unlock cycle
        {
            let _lock = input_buffer
                .lock()
                .map_err(|e| eprintln!("[screen] NVENC: pitch discovery lock failed: {:?}", e))
                .ok()?;
        }
        let pitch = input_buffer.pitch();

        eprintln!(
            "[screen] NVENC encoder initialized ({}x{}, {}kbps, pitch={})",
            width, height, bitrate_kbps, pitch
        );

        // SAFETY: Buffer<'a> and Bitstream<'a> borrow from &'a Encoder inside the
        // Box<Session>. The Box keeps the Session at a stable heap address, so the
        // reference survives struct moves. Our Drop impl drops buffers before session.
        let input_buffer: Buffer<'static> = unsafe { std::mem::transmute(input_buffer) };
        let output_bitstream: Bitstream<'static> = unsafe { std::mem::transmute(output_bitstream) };

        Some(Self {
            input_buffer: ManuallyDrop::new(input_buffer),
            output_bitstream: ManuallyDrop::new(output_bitstream),
            session: ManuallyDrop::new(session),
            width,
            height,
            pitch,
            _cuda_ctx: cuda_ctx,
        })
    }
}

impl ScreenEncoder for NvencEncoder {
    fn encode(&mut self, frame: &FrameData) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let stride = self.width as usize * 4;

        // NVENC ARGB = BGRA byte order on little-endian, so BGRA frames
        // can be passed directly with zero conversion
        let bgra_data: std::borrow::Cow<[u8]> = if frame.is_bgra {
            std::borrow::Cow::Borrowed(&frame.data)
        } else {
            // RGBA -> BGRA: swap R and B channels
            let mut bgra = frame.data.clone();
            for px in bgra.chunks_exact_mut(4) {
                px.swap(0, 2);
            }
            std::borrow::Cow::Owned(bgra)
        };

        // Lock input buffer and write frame data with pitch awareness
        {
            let pitch = self.pitch as usize;
            let mut lock = self.input_buffer.lock()?;
            if pitch == stride || pitch == 0 {
                unsafe { lock.write(&bgra_data) };
            } else {
                // Row-by-row copy with pitch padding
                let h = self.height as usize;
                let mut pitched = vec![0u8; pitch * h];
                for row in 0..h {
                    let src_off = row * stride;
                    let dst_off = row * pitch;
                    pitched[dst_off..dst_off + stride]
                        .copy_from_slice(&bgra_data[src_off..src_off + stride]);
                }
                unsafe { lock.write(&pitched) };
            }
        }

        // Encode the picture
        self.session.encode_picture(
            &mut *self.input_buffer,
            &mut *self.output_bitstream,
            EncodePictureParams::default(),
        )?;

        // Read encoded H.264 bitstream
        let lock = self.output_bitstream.lock()?;
        let encoded = lock.data().to_vec();

        Ok(encoded)
    }

    fn force_keyframe(&mut self) {
        // No-op — gopLength=60 handles periodic IDR keyframes
    }
}
