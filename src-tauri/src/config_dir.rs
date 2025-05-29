use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub root_dir: Option<String>,
}

#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = app
        .path()
        .config_dir()
        .map_err(|e| e.to_string())?
        .join("config.json");

    if path.exists() {
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    } else {
        Ok(AppConfig::default())
    }
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let path = app
        .path()
        .config_dir()
        .map_err(|e| e.to_string())?
        .join("config.json");

    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let data = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}
