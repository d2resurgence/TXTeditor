use crate::native_paths::file_path_to_string;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) vector_lsp_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) schema_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) lint_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) schema_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) plugin_path: Option<String>,
    #[serde(default)]
    pub(crate) debug_logging: bool,
    #[serde(default)]
    pub(crate) restore_workspace: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_workspace_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) strings_path: Option<String>,
    #[serde(default)]
    pub(crate) lsp_preload_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) lsp_preload_skip: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) autofit_columns: Option<Value>,
}

pub(crate) struct AppConfigState {
    pub(crate) config: Mutex<AppConfig>,
    pub(crate) config_path: PathBuf,
}

pub(crate) fn load_app_config_from(path: &Path) -> AppConfig {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub(crate) fn config_search_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("config.json"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("config.json"));
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut path = exe.as_path();
        for _ in 0..4 {
            path = match path.parent() {
                Some(parent) => parent,
                None => break,
            };
        }
        candidates.push(path.join("config.json"));
    }
    candidates
}

pub(crate) fn resolve_app_config_path(appdata_config: PathBuf) -> PathBuf {
    resolve_app_config_path_from(appdata_config, &config_search_candidates())
}

fn resolve_app_config_path_from(appdata_config: PathBuf, candidates: &[PathBuf]) -> PathBuf {
    candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .unwrap_or(appdata_config)
}

#[tauri::command]
pub(crate) fn get_config(state: tauri::State<'_, AppConfigState>) -> AppConfig {
    state.config.lock().unwrap().clone()
}

#[tauri::command]
pub(crate) fn save_config(
    config: AppConfig,
    state: tauri::State<'_, AppConfigState>,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    let path = &state.config_path;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, json).map_err(|e| e.to_string())?;
    *state.config.lock().unwrap() = config;
    Ok(())
}

#[tauri::command]
pub(crate) async fn pick_file_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .blocking_pick_file()
        .map(file_path_to_string)
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_app_config_from_defaults_on_missing_or_invalid_json() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-config-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("missing.json");
        let invalid = dir.join("invalid.json");
        fs::write(&invalid, "{not valid json").unwrap();

        assert!(load_app_config_from(&missing).vector_lsp_path.is_none());
        assert_eq!(load_app_config_from(&missing).debug_logging, false);
        assert!(load_app_config_from(&invalid).schema_path.is_none());
        assert_eq!(load_app_config_from(&invalid).debug_logging, false);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn app_config_uses_camel_case_and_skips_empty_options() {
        let config = AppConfig {
            vector_lsp_path: Some("E:\\Tools\\vector-lsp.exe".to_string()),
            schema_path: None,
            lint_mode: Some("legacy".to_string()),
            schema_version: Some("3.2".to_string()),
            plugin_path: None,
            debug_logging: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"vectorLspPath\""));
        assert!(json.contains("\"lintMode\""));
        assert!(json.contains("\"schemaVersion\""));
        assert!(json.contains("\"debugLogging\":true"));
        assert!(!json.contains("schema_path"));
        assert!(!json.contains("schemaPath"));
        assert!(!json.contains("pluginPath"));
    }

    #[test]
    fn load_app_config_from_reads_saved_camel_case_fields() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-config-load-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(
            &path,
            r#"{"vectorLspPath":"E:\\Tools\\vector-lsp.exe","lintMode":"basic","debugLogging":true,"restoreWorkspace":true,"lastWorkspacePath":"D:\\mods","stringsPath":"D:\\strings","lspPreloadEnabled":true,"lspPreloadSkip":["AiParms"],"autofitColumns":{"*":true}}"#,
        )
        .unwrap();

        let config = load_app_config_from(&path);
        assert_eq!(
            config.vector_lsp_path.as_deref(),
            Some("E:\\Tools\\vector-lsp.exe")
        );
        assert_eq!(config.lint_mode.as_deref(), Some("basic"));
        assert_eq!(config.debug_logging, true);
        assert_eq!(config.restore_workspace, true);
        assert_eq!(config.last_workspace_path.as_deref(), Some("D:\\mods"));
        assert_eq!(config.strings_path.as_deref(), Some("D:\\strings"));
        assert_eq!(config.lsp_preload_enabled, true);
        assert_eq!(config.lsp_preload_skip.as_deref(), Some(&["AiParms".to_string()][..]));
        assert_eq!(config.autofit_columns.as_ref().and_then(|v| v.get("*")).and_then(|v| v.as_bool()), Some(true));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_app_config_path_prefers_first_existing_candidate() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-config-resolve-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let portable = dir.join("portable").join("config.json");
        let cwd = dir.join("cwd-config.json");
        let fallback = dir.join("fallback-config.json");
        fs::create_dir_all(portable.parent().unwrap()).unwrap();
        fs::write(&portable, r#"{"lintMode":"legacy"}"#).unwrap();
        fs::write(&cwd, r#"{"lintMode":"basic"}"#).unwrap();

        let resolved = resolve_app_config_path_from(
            fallback.clone(),
            &[portable.clone(), cwd.clone()],
        );
        assert_eq!(resolved, portable);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_app_config_path_uses_appdata_when_no_candidate_exists() {
        let dir =
            std::env::temp_dir().join(format!("txteditor-config-fallback-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("missing-config.json");
        let fallback = dir.join("appdata-config.json");

        let resolved = resolve_app_config_path_from(fallback.clone(), &[missing]);
        assert_eq!(resolved, fallback);

        let _ = fs::remove_dir_all(&dir);
    }
}
