//! Tauri コマンドの入口（申告の取得）。

use crate::engine::analyzer::analysis_fixed_values;
use crate::engine::probe::ProbeToken;
use crate::engine::state::AppState;
use crate::engine::types::{ProbeOutcome, StartFailure};

/// エンジンを起こして申告だけを取り、落とす。プリセット編集が、取った定義をプリセットに残すのに使う。
///
/// `reserved` は解析で起動したときに評価関数・定跡・固定値が持つ名前
#[tauri::command]
pub async fn probe_engine(
    state: tauri::State<'_, AppState>,
    engine_path: String,
    token: ProbeToken,
) -> Result<ProbeOutcome, StartFailure> {
    state
        .prober
        .probe(&engine_path, token, &analysis_fixed_values())
        .await
}
