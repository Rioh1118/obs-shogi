use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const PRESETS_FILE: &str = "engine_presets.json";

#[derive(Serialize, Deserialize, Default)]
pub struct PresetsFile {
    pub presets: Vec<EnginePreset>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EnginePreset {
    pub id: String,
    pub label: String,

    pub ai_name: String,

    // 実体（絶対パス）
    pub engine_path: String,
    pub eval_file_path: String,

    // book は任意
    pub book_enabled: bool,
    pub book_file_path: Option<String>,

    pub options: HashMap<String, String>,
    pub analysis: Option<AnalysisDefaults>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisDefaults {
    pub time_seconds: Option<u32>,
    pub depth: Option<u32>,
    pub nodes: Option<u64>,
    pub mate_search: Option<bool>,
}

fn presets_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(PRESETS_FILE))
}

fn ensure_non_empty(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    Ok(())
}

fn validate_one_preset(p: &EnginePreset) -> Result<(), String> {
    // id は必須（uuid想定）
    ensure_non_empty("id", &p.id)?;
    Ok(())
}

#[tauri::command]
pub fn load_presets(app: AppHandle) -> Result<PresetsFile, String> {
    let path = presets_path(&app)?;
    if path.exists() {
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let file: PresetsFile = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        Ok(file)
    } else {
        Ok(PresetsFile::default())
    }
}

#[tauri::command]
pub fn save_presets(app: AppHandle, file: PresetsFile) -> Result<(), String> {
    // バリデーション（“未設定プリセットを保存したい” なら緩め推奨）
    for p in &file.presets {
        validate_one_preset(p)?;
    }

    let path = presets_path(&app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let data = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}
