use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const MARKS_FILE: &str = "marks.json";

/// level: 0=none, 1..4=importance
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MarkEntry {
    pub id: String,
    pub tesuu: u32,
    pub move_text: String,
    pub level: u8,
    pub tags: Vec<String>,
    pub note: String,
}

/// tesuuPointer -> MarkEntry
pub type FileMarks = HashMap<String, MarkEntry>;

/// absPath -> FileMarks
#[derive(Serialize, Deserialize, Default)]
pub struct MarksStore {
    pub files: HashMap<String, FileMarks>,
}

fn marks_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(MARKS_FILE))
}

#[tauri::command]
pub fn load_marks(app: AppHandle) -> Result<MarksStore, String> {
    let path = marks_path(&app)?;
    if path.exists() {
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let store: MarksStore = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        Ok(store)
    } else {
        Ok(MarksStore::default())
    }
}

#[tauri::command]
pub fn save_marks(app: AppHandle, store: MarksStore) -> Result<(), String> {
    let path = marks_path(&app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let data = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}
