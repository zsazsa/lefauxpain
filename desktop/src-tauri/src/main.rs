#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "linux")]
            {
                let window = app.get_webview_window("main").unwrap();
                window.with_webview(|webview| {
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
                    }
                    // Auto-grant microphone permission requests
                    wv.connect_permission_request(|_, request| {
                        request.allow();
                        true
                    });
                    // Inject desktop flag into every page (including remote)
                    if let Some(manager) = wv.user_content_manager() {
                        let script = UserScript::new(
                            "window.__DESKTOP__ = true;",
                            UserContentInjectedFrames::TopFrame,
                            UserScriptInjectionTime::Start,
                            &[],
                            &[],
                        );
                        manager.add_script(&script);
                    }
                })?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
