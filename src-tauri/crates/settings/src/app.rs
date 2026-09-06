//! `app.json` の形と置き場。

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

use ::fs::write::atomic_write;

pub const CONFIG_FILE: &str = "app.json";

/// **`#[serde(default)]` を外さない。** 外すと、フィールドを1つ足した時点で
/// 既存利用者の `app.json` が parse に失敗し、パスを受ける全コマンドが落ちる
/// （関門が `app.json` を読むため）。
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AppConfig {
    pub root_dir: Option<String>,
    pub ai_root: Option<String>,
    pub last_preset_id: Option<String>,
}

pub fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(CONFIG_FILE))
}

pub fn read_or_default(app: &AppHandle) -> Result<AppConfig, String> {
    let path = config_path(app)?;
    if path.exists() {
        let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())
    } else {
        Ok(AppConfig::default())
    }
}

pub fn write(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let data = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    atomic_write(&path, data.as_bytes()).map_err(|e| e.to_string())
}

/// 読めなかった `app.json` を退避する。**上書きの前に呼ぶ。**
///
/// [`write`] はファイルごと置き換えるので、読めなかった設定に対して
/// 呼び出し元が組み立てた値を書くと、読めていない欄（`ai_root` /
/// `last_preset_id`）が `null` として書き潰される。壊れた JSON でも、
/// 中の文字列は利用者が選んだ場所そのもの。**捨てる前に取っておく。**
///
/// 退避先を返す。無ければ `None`
pub fn back_up_broken(app: &AppHandle) -> Result<Option<String>, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    // 上書きされないように、既にある退避先は避ける
    let mut backup = path.with_extension("json.broken");
    for n in 1..100 {
        if !backup.exists() {
            break;
        }
        backup = path.with_extension(format!("json.broken.{n}"));
    }

    fs::rename(&path, &backup).map_err(|e| e.to_string())?;
    Ok(Some(backup.to_string_lossy().to_string()))
}
