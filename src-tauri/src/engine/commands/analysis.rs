//! Tauri コマンドの入口（解析）。
//!
//! **`EngineBridge` と同じファイルに置かない。** ここは `AppState` を受け取る
//! アダプタで、`AppState` は `EngineBridge` を持つ。同居させると
//! 「facade が state を知り、state が facade を知る」という環になる。
//!
//! ここがやるのは `AppState` から持ち物を取り出して渡すことだけ。
//! **判断を書かない**——書くと、同じ判断が `EngineBridge` 側にもできる。

use crate::engine::analyzer::DepthOutcome;
use crate::engine::state::AppState;
use crate::engine::types::*;

// === Tauriコマンド定義 ===

#[tauri::command]
pub async fn initialize_engine(
    state: tauri::State<'_, AppState>,
    engine_path: String,
    working_dir: Option<String>,
) -> Result<(), String> {
    state
        .bridge
        .initialize_engine_impl(engine_path, working_dir)
        .await
}

#[tauri::command]
pub async fn shutdown_engine(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.bridge.shutdown_engine_impl().await
}

#[tauri::command]
pub async fn set_position(
    state: tauri::State<'_, AppState>,
    position: String,
) -> Result<(), String> {
    state.bridge.set_position_impl(position).await
}

#[tauri::command]
pub async fn start_infinite_analysis(state: tauri::State<'_, AppState>) -> Result<String, String> {
    state.bridge.start_infinite_analysis_impl().await
}

#[tauri::command]
pub async fn analyze_with_time(
    state: tauri::State<'_, AppState>,
    time_seconds: u64,
) -> Result<AnalysisResult, String> {
    state.bridge.analyze_with_time_impl(time_seconds).await
}

#[tauri::command]
pub async fn analyze_with_depth(
    state: tauri::State<'_, AppState>,
    depth: u32,
) -> Result<DepthOutcome, String> {
    state.bridge.analyze_with_depth_impl(depth).await
}

#[tauri::command]
pub async fn stop_analysis(
    state: tauri::State<'_, AppState>,
    session_id: Option<String>,
) -> Result<(), String> {
    state.bridge.stop_analysis_impl(session_id).await
}

#[tauri::command]
pub async fn get_analysis_result(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Option<AnalysisResult>, String> {
    state.bridge.get_analysis_result_impl(session_id).await
}

#[tauri::command]
pub async fn get_last_result(
    state: tauri::State<'_, AppState>,
) -> Result<Option<AnalysisResult>, String> {
    state.bridge.get_last_result_impl().await
}

#[tauri::command]
pub async fn apply_engine_settings(
    state: tauri::State<'_, AppState>,
    settings: EngineSettings,
) -> Result<(), String> {
    state.bridge.apply_engine_settings_impl(settings).await
}

#[tauri::command]
pub async fn get_engine_settings(
    state: tauri::State<'_, AppState>,
) -> Result<EngineSettings, String> {
    state.bridge.get_engine_settings_impl().await
}

#[tauri::command]
pub async fn get_analysis_status(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<AnalysisStatus>, String> {
    state.bridge.get_analysis_status_impl().await
}

#[tauri::command]
pub async fn get_engine_info(
    state: tauri::State<'_, AppState>,
) -> Result<Option<EngineInfo>, String> {
    state.bridge.get_engine_info_impl().await
}
