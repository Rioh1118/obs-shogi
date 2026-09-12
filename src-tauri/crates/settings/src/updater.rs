//! 更新の告知をどこまで見せたかの記憶。
//!
//! **`app.json` に相乗りさせない。** 理由は2つある。
//!
//! 1. [`crate::app::write`] はファイルごと置き換えるので、`app.json` を持つ側と
//!    ここを書く側が別々に読んで別々に書くと、後から書いたほうが相手の欄を
//!    `null` で潰す。更新の告知は利用者の操作と無関係な時刻に書くので、
//!    潰し合う窓が常に開いたままになる
//! 2. `app.json` が壊れているとき、更新の導線は**残っていなければならない**
//!    （壊れた状態を直す版が、壊れているせいで届かなくなる）。同じファイルに
//!    置くと、読めない `app.json` が「飛ばす版」も道連れにする
//!
//! 失われても損害は「告知が1回余分に出る」だけなので、原子的に書く以上の
//! 手当ては持たない。

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use ::fs::write::atomic_write;

/// 置き場。`app_config_dir` の下、`app.json` の隣。
pub const UPDATER_FILE: &str = "updater.json";

/// **`#[serde(default)]` を外さない。** 外すと、欄を1つ足した時点で既存利用者の
/// `updater.json` が parse に失敗する。失敗したときの既定は「何も飛ばしていない」
/// なので実害は告知が出ることだけだが、`last_checked_ms` まで一緒に消える。
#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(default, rename_all = "camelCase")]
pub struct UpdaterState {
    /// 告知を出さないと決めた版。`check` が返す `version` と同じ綴り。
    ///
    /// **「後で」はここに来ない。** あちらはその起動の間だけ黙らせるもので、
    /// 次の起動では出さなければならない。ここへ書くと、押した本人が
    /// 意図していない期間まで黙る。
    pub skipped_version: Option<String>,

    /// 最後に**確認が通った**時刻（UNIX ミリ秒）。
    ///
    /// **失敗した確認では更新しない。** 更新すると「確認できている」と
    /// 「確認できていないが試みた」が同じ値になり、配布先が壊れていることを
    /// 読み取る手掛かりが消える。これが古いまま止まっていることだけが、
    /// 利用者から見える唯一の徴候になる。
    pub last_checked_ms: Option<u64>,
}

fn updater_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(UPDATER_FILE))
}

/// 読む。無ければ・壊れていれば既定値。
///
/// **壊れていても `Err` を返さない。** 呼び出し元は更新の告知を出す側で、
/// ここが読めないことを利用者に見せる意味が無い。既定値は「何も飛ばしていない」
/// なので、壊れたときに倒れる先は**告知が出る**側になる。
pub fn read_or_default<R: Runtime>(app: &AppHandle<R>) -> Result<UpdaterState, String> {
    let path = updater_path(app)?;
    if !path.exists() {
        return Ok(UpdaterState::default());
    }
    let Ok(data) = fs::read_to_string(&path) else {
        return Ok(UpdaterState::default());
    };
    Ok(serde_json::from_str(&data).unwrap_or_default())
}

/// 書く。
pub fn write<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState) -> Result<(), String> {
    let path = updater_path(app)?;
    let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    atomic_write(&path, data.as_bytes()).map_err(|e| e.to_string())
}
