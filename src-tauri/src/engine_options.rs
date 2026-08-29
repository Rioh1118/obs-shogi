use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use usi::UsiEngineHandler;

use crate::engine::protocol::UsiProtocol;
use crate::engine::types::{EngineError, EngineOption};
use crate::file_system::utils::atomic_write;

const LOGT: &str = "obs_shogi::engine_options";
const CACHE_SUBDIR: &str = "engine-options";
const PROBE_TIMEOUT_SECS: u64 = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedOptions {
    engine_path: String,
    options: Vec<EngineOption>,
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(CACHE_SUBDIR))
}

fn cache_path_for(app: &AppHandle, engine_path: &str) -> Result<PathBuf, String> {
    // 任意の絶対パスを安全なファイル名にするため hash。blake3 は既に
    // 依存に含まれており、衝突実害ゼロ・キー透明性は engine_path を本文に
    // 入れることでカバーする。
    let hash = blake3::hash(engine_path.as_bytes());
    let filename = format!("{}.json", hash.to_hex());
    Ok(cache_dir(app)?.join(filename))
}

fn load_cached(app: &AppHandle, engine_path: &str) -> Option<Vec<EngineOption>> {
    let path = cache_path_for(app, engine_path).ok()?;
    if !path.exists() {
        return None;
    }
    let data = fs::read_to_string(&path).ok()?;
    let cached: CachedOptions = serde_json::from_str(&data).ok()?;
    if cached.engine_path != engine_path {
        return None;
    }
    Some(cached.options)
}

fn save_cached(
    app: &AppHandle,
    engine_path: &str,
    options: &[EngineOption],
) -> Result<(), String> {
    let path = cache_path_for(app, engine_path)?;
    let payload = CachedOptions {
        engine_path: engine_path.to_string(),
        options: options.to_vec(),
    };
    let data = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    atomic_write(&path, data.as_bytes()).map_err(|e| e.to_string())
}

fn canonical_engine_path(engine_path: &str) -> Result<String, String> {
    let resolved = std::fs::canonicalize(engine_path)
        .map_err(|e| format!("engine_path is not a valid existing path: {e}"))?;
    if !resolved.is_file() {
        return Err("engine_path must point to an existing file".to_string());
    }
    Ok(resolved.to_string_lossy().to_string())
}

async fn probe_options(engine_path: &str) -> Result<Vec<EngineOption>, EngineError> {
    let work_dir = Path::new(engine_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or(".")
        .to_string();

    log::info!(target: LOGT, "probe: spawn engine_path='{}'", engine_path);

    let handler = UsiEngineHandler::spawn(engine_path, &work_dir)
        .map_err(|e| EngineError::StartupFailed(format!("Failed to spawn engine: {}", e)))?;

    let protocol = UsiProtocol::new(handler);

    let info_result = tokio::time::timeout(
        Duration::from_secs(PROBE_TIMEOUT_SECS),
        protocol.get_engine_info(),
    )
    .await;

    // 解析セッションと別プロセスとして起動した probe は必ず後始末する。
    // 失敗時もここで落とさないと孤児プロセスが残る。
    protocol.kill_engine().await;

    match info_result {
        Ok(Ok(info)) => {
            log::info!(
                target: LOGT,
                "probe: ok name='{}' options={}",
                info.name,
                info.options.len()
            );
            Ok(info.options)
        }
        Ok(Err(e)) => {
            log::warn!(target: LOGT, "probe: protocol error: {:?}", e);
            Err(e)
        }
        Err(_) => {
            log::warn!(target: LOGT, "probe: timeout after {}s", PROBE_TIMEOUT_SECS);
            Err(EngineError::Timeout(format!(
                "engine option probe timed out after {}s",
                PROBE_TIMEOUT_SECS
            )))
        }
    }
}

#[tauri::command]
pub async fn get_engine_options(
    app: AppHandle,
    engine_path: String,
) -> Result<Vec<EngineOption>, String> {
    let canonical = canonical_engine_path(&engine_path)?;

    if let Some(cached) = load_cached(&app, &canonical) {
        log::debug!(target: LOGT, "get_engine_options: cache hit");
        return Ok(cached);
    }

    let options = probe_options(&canonical)
        .await
        .map_err(|e| format!("probe failed: {:?}", e))?;
    save_cached(&app, &canonical, &options)?;
    Ok(options)
}

#[tauri::command]
pub async fn rescan_engine_options(
    app: AppHandle,
    engine_path: String,
) -> Result<Vec<EngineOption>, String> {
    let canonical = canonical_engine_path(&engine_path)?;
    let options = probe_options(&canonical)
        .await
        .map_err(|e| format!("probe failed: {:?}", e))?;
    save_cached(&app, &canonical, &options)?;
    Ok(options)
}
