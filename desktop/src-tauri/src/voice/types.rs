use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SdpAnswer {
    pub sdp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IceCandidateOut {
    pub candidate: String,
    #[serde(rename = "sdpMid")]
    pub sdp_mid: Option<String>,
    #[serde(rename = "sdpMLineIndex")]
    pub sdp_mline_index: Option<u16>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IceCandidateIn {
    pub candidate: String,
    #[serde(rename = "sdpMid")]
    pub sdp_mid: Option<String>,
    #[serde(rename = "sdpMLineIndex")]
    pub sdp_mline_index: Option<u16>,
}

#[derive(Debug, Serialize, Clone)]
pub struct SpeakingEvent {
    pub speaking: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ConnectionStateEvent {
    pub state: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioDeviceList {
    pub inputs: Vec<AudioDeviceInfo>,
    pub outputs: Vec<AudioDeviceInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}
