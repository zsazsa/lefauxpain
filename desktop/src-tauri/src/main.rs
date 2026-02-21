#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "linux")]
mod screen;
mod voice;

use std::sync::Arc;
#[cfg(target_os = "linux")]
use tauri::Manager;
use serde::Serialize;
use std::process::Command;
use tokio::sync::Mutex;
#[cfg(target_os = "linux")]
use base64::Engine;
#[cfg(target_os = "linux")]
use image::ImageEncoder;

use voice::{
    VoiceEngine,
    voice_start, voice_stop, voice_handle_offer, voice_handle_ice,
    voice_set_mute, voice_set_deafen, voice_set_master_volume, voice_set_mic_gain,
    voice_list_devices, voice_set_input_device, voice_set_output_device,
};
#[cfg(target_os = "linux")]
use screen::{
    ScreenEngine,
    screen_start, screen_stop, screen_handle_offer, screen_handle_ice,
};

#[derive(Serialize, Clone)]
struct AudioDevice {
    id: String,
    name: String,
    default: bool,
}

#[derive(Serialize)]
struct AudioDevices {
    inputs: Vec<AudioDevice>,
    outputs: Vec<AudioDevice>,
}

fn parse_wpctl_section(output: &str, section: &str) -> Vec<AudioDevice> {
    // No ^ anchor: wpctl lines have │ box-drawing chars that \s can't match
    let re = regex::Regex::new(r"(\*)?\s*(\d+)\.\s+(.+?)\s+\[vol:").unwrap();
    let mut devices = Vec::new();
    let mut in_audio = false;
    let mut in_section = false;

    for line in output.lines() {
        if line.starts_with("Audio") {
            in_audio = true;
            continue;
        }
        if in_audio && !line.starts_with(' ') && !line.is_empty() {
            in_audio = false;
            in_section = false;
            continue;
        }
        if !in_audio {
            continue;
        }

        let trimmed = line.trim();
        let section_markers = [
            format!("\u{251c}\u{2500} {}:", section),
            format!("\u{2514}\u{2500} {}:", section),
        ];
        if section_markers.iter().any(|m| trimmed.starts_with(m.as_str())) {
            in_section = true;
            continue;
        }
        if in_section && (trimmed.starts_with("\u{251c}\u{2500} ") || trimmed.starts_with("\u{2514}\u{2500} ")) {
            in_section = false;
            continue;
        }
        if !in_section {
            continue;
        }

        if let Some(caps) = re.captures(line) {
            devices.push(AudioDevice {
                id: caps[2].to_string(),
                name: caps[3].trim().to_string(),
                default: caps.get(1).map_or(false, |m| m.as_str() == "*"),
            });
        }
    }
    devices
}

fn get_audio_devices() -> AudioDevices {
    let output = Command::new("wpctl")
        .arg("status")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .unwrap_or_default();

    AudioDevices {
        inputs: parse_wpctl_section(&output, "Sources"),
        outputs: parse_wpctl_section(&output, "Sinks"),
    }
}

#[tauri::command]
fn list_audio_devices() -> AudioDevices {
    get_audio_devices()
}

#[tauri::command]
fn set_default_audio_device(id: String) -> bool {
    Command::new("wpctl")
        .args(["set-default", &id])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn read_clipboard_image() -> Option<String> {
    let mut clipboard = match arboard::Clipboard::new() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[clipboard] failed to open: {e}");
            return None;
        }
    };

    // Try reading raw image data from clipboard (e.g. Print Screen, gnome-screenshot)
    match clipboard.get_image() {
        Ok(img) => {
            let rgba = image::RgbaImage::from_raw(
                img.width as u32,
                img.height as u32,
                img.bytes.into_owned(),
            )?;

            let mut buf = Vec::new();
            let encoder = image::codecs::png::PngEncoder::new(&mut buf);
            encoder
                .write_image(rgba.as_raw(), rgba.width(), rgba.height(), image::ExtendedColorType::Rgba8)
                .ok()?;

            return Some(base64::engine::general_purpose::STANDARD.encode(&buf));
        }
        Err(_) => {}
    }

    // Fallback: clipboard text might be a file path to an image
    // (WebKitGTK often pastes image file paths instead of image data)
    if let Ok(text) = clipboard.get_text() {
        let path = text.trim();
        let path = path.strip_prefix("file://").unwrap_or(path);
        let p = std::path::Path::new(path);
        if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            if matches!(ext.to_lowercase().as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp") {
                if let Ok(data) = std::fs::read(p) {
                    return Some(base64::engine::general_purpose::STANDARD.encode(&data));
                }
            }
        }
    }

    None
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(Mutex::new(VoiceEngine::new())) as voice::VoiceState);

    #[cfg(target_os = "linux")]
    let builder = builder
        .manage(Arc::new(Mutex::new(ScreenEngine::new())) as screen::ScreenState);

    builder
        .invoke_handler(tauri::generate_handler![
            list_audio_devices,
            set_default_audio_device,
            // Voice commands
            voice_start,
            voice_stop,
            voice_handle_offer,
            voice_handle_ice,
            voice_set_mute,
            voice_set_deafen,
            voice_set_master_volume,
            voice_set_mic_gain,
            voice_list_devices,
            voice_set_input_device,
            voice_set_output_device,
            // Clipboard image read (Linux only — WebKitGTK doesn't expose image clipboard data)
            #[cfg(target_os = "linux")]
            read_clipboard_image,
            // Screen share commands (Linux only — PipeWire capture)
            #[cfg(target_os = "linux")]
            screen_start,
            #[cfg(target_os = "linux")]
            screen_stop,
            #[cfg(target_os = "linux")]
            screen_handle_offer,
            #[cfg(target_os = "linux")]
            screen_handle_ice,
        ])
        .setup(|_app| {
            #[cfg(target_os = "linux")]
            {
                let window = _app.get_webview_window("main").unwrap();
                // Enumerate local audio devices and build injection script
                let devices = get_audio_devices();
                let devices_json = serde_json::to_string(&devices).unwrap_or_default();
                let inject_script = format!(
                    "window.__DESKTOP__ = true; window.__AUDIO_DEVICES__ = {}; console.log('[tauri] RTCPeerConnection available:', typeof RTCPeerConnection !== 'undefined');",
                    devices_json
                );

                window.with_webview(move |webview| {
                    use webkit2gtk::{
                        WebViewExt, SettingsExt, PermissionRequestExt,
                        UserContentManagerExt, UserContentInjectedFrames,
                        UserScript, UserScriptInjectionTime,
                    };

                    let wv = webview.inner();
                    if let Some(settings) = wv.settings() {
                        settings.set_enable_media_stream(true);
                        settings.set_enable_media_capabilities(true);
                        settings.set_media_playback_requires_user_gesture(false);
                        settings.set_enable_webrtc(true);
                        settings.set_enable_developer_extras(true);
                        settings.set_enable_write_console_messages_to_stdout(true);
                        eprintln!("[tauri] WebRTC enabled: {}", settings.enables_webrtc());
                    }
                    // Auto-grant microphone permission requests
                    wv.connect_permission_request(|_, request| {
                        request.allow();
                        true
                    });
                    // Inject desktop flag + audio devices into every page
                    if let Some(manager) = wv.user_content_manager() {
                        let script = UserScript::new(
                            &inject_script,
                            UserContentInjectedFrames::TopFrame,
                            UserScriptInjectionTime::Start,
                            &[],
                            &[],
                        );
                        manager.add_script(&script);
                    }
                    // Reload so the web process picks up enable_webrtc
                    wv.reload();
                })?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
