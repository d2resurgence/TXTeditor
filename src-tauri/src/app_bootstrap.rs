use crate::config::{load_app_config_from, resolve_app_config_path, AppConfigState};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[tauri::command]
pub(crate) fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|e| e.to_string())
}

pub(crate) fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Search for config.json in order:
    //   1. beside the executable (portable installs)
    //   2. current working directory
    //   3. project root above the exe (dev: src-tauri/target/release/)
    //   4. AppData (fallback when no local config exists)
    let appdata_config = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("config.json");
    let config_path = resolve_app_config_path(appdata_config);
    let config = load_app_config_from(&config_path);
    app.manage(AppConfigState {
        config: Mutex::new(config),
        config_path,
    });
    if let Some(window) = app.get_webview_window("main") {
        let win = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.emit("app-close-requested", ());
            }
        });
    }
    Ok(())
}
