use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "app.json";

#[derive(Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub root_dir: Option<String>,
    pub ai_root: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .config_dir()
        .map_err(|e| e.to_string())?
        .join(CONFIG_FILE))
}

fn validate_dir(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    let p = Path::new(value);
    if !p.exists() {
        return Err(format!("{label} does not exist: {value}"));
    }

    if !p.is_dir() {
        return Err(format!("{label} is not a directory: {value}"));
    }

    Ok(())
}

#[tauri::command]
pub fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    if path.exists() {
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    } else {
        Ok(AppConfig::default())
    }
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let root_dir = config.root_dir.as_deref().ok_or("root_dir is required")?;
    validate_dir("root_dir", root_dir)?;

    if let Some(ai_root) = config.ai_root.as_deref() {
        validate_dir("ai_root", ai_root)?;
    }

    let path = config_path(&app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let data = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}
