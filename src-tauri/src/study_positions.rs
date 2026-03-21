use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

const STUDY_POSITIONS_FILE_NAME: &str = "study_positions.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StudyPositionState {
    Inbox,
    Active,
    Reference,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyPosition {
    pub id: String,
    pub sfen: String,
    pub label: String,
    pub description: String,
    pub state: StudyPositionState,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StudyPositionsFile {
    pub positions: Vec<StudyPosition>,
}

fn study_positions_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve app_config_dir: {e}"))?;

    Ok(config_dir.join(STUDY_POSITIONS_FILE_NAME))
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "study_positions path has no parent".to_string())?;

    fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create config dir {}: {e}", parent.display()))
}

fn read_file_or_default(path: &Path) -> Result<StudyPositionsFile, String> {
    if !path.exists() {
        return Ok(StudyPositionsFile::default());
    }

    let text =
        fs::read_to_string(path).map_err(|e| format!("failed to read {}: {e}", path.display()))?;

    if text.trim().is_empty() {
        return Ok(StudyPositionsFile::default());
    }

    serde_json::from_str::<StudyPositionsFile>(&text)
        .map_err(|e| format!("failed to parse {}: {e}", path.display()))
}

fn write_file(path: &Path, input: &StudyPositionsFile) -> Result<(), String> {
    ensure_parent_dir(path)?;

    let text = serde_json::to_string_pretty(input)
        .map_err(|e| format!("failed to serialize study positions: {e}"))?;

    fs::write(path, text).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

#[tauri::command]
pub fn load_study_positions<R: Runtime>(app: AppHandle<R>) -> Result<StudyPositionsFile, String> {
    let path = study_positions_path(&app)?;
    read_file_or_default(&path)
}

#[tauri::command]
pub fn save_study_positions<R: Runtime>(
    app: AppHandle<R>,
    input: StudyPositionsFile,
) -> Result<(), String> {
    let path = study_positions_path(&app)?;
    write_file(&path, &input)
}
