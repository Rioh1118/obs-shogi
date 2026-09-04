//! 設定を読み書きする Tauri コマンドの入口。
//!
//! **判断を書かない。** 何を既定値にするか、どう検証するかは下の段が持つ。

use tauri::{AppHandle, Runtime};

use crate::app::AppConfig;
use crate::presets::PresetsFile;
use crate::study::StudyPositionsFile;
use crate::{app, presets, study};

#[tauri::command]
pub fn load_config(app_handle: AppHandle) -> Result<AppConfig, String> {
    app::read_or_default(&app_handle)
}

#[tauri::command]
// TODO(#215): `config.root_dir` を無検証で受ける。ここが root を決める側なので
// `validate_under_root` を掛けられない。webview から直に呼べば関門を全開にできる。
// 免除は `tests/root_guard.rs` の EXEMPT に理由つきで並べてある
pub fn save_config(app_handle: AppHandle, config: AppConfig) -> Result<(), String> {
    app::write(&app_handle, &config)
}

#[tauri::command]
pub fn backup_broken_config(app_handle: AppHandle) -> Result<Option<String>, String> {
    app::back_up_broken(&app_handle)
}

#[tauri::command]
pub fn load_presets(app_handle: AppHandle) -> Result<PresetsFile, String> {
    presets::read_or_default(&app_handle)
}

#[tauri::command]
pub fn save_presets(app_handle: AppHandle, file: PresetsFile) -> Result<(), String> {
    presets::write(&app_handle, &file)
}

#[tauri::command]
pub fn load_study_positions<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<StudyPositionsFile, String> {
    study::read_or_default(&app_handle)
}

#[tauri::command]
pub fn save_study_positions<R: Runtime>(
    app_handle: AppHandle<R>,
    input: StudyPositionsFile,
) -> Result<(), String> {
    study::write(&app_handle, &input)
}
