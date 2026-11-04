//! 更新の告知をどこまで見せたかの記憶。
//!
//! `app.json` に相乗りさせない。理由は2つある。
//!
//! 1. [`crate::app::write`] はファイルごと置き換えるので、`app.json` を持つ側と
//!    ここを書く側が別々に読んで別々に書くと、後から書いたほうが相手の欄を
//!    `null` で潰す。更新の告知は利用者の操作と無関係な時刻に書くので、
//!    潰し合う窓が常に開いたままになる
//! 2. `app.json` が壊れているときも、更新の導線は**残っていなければならない**
//!    （壊れた状態を直す版が、壊れているせいで届かなくなる）。同じファイルに
//!    置くと、読めない `app.json` が「飛ばす版」も道連れにする
//!
//! 失われても損害は「告知が1回余分に出る」だけなので、原子的に書く以上の
//! 手当ては持たない。

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

use ::fs::write::atomic_write;

/// 置き場。`app_config_dir` の下、`app.json` の隣。
pub const UPDATER_FILE: &str = "updater.json";

/// `updater.json` の中身。欠けた欄は `None` で読む
///
/// `#[serde(default)]` を外さない。外したうえで `Option` でない欄を足すと、その欄を持たない
/// 既存利用者の `updater.json` が parse に失敗する。失敗したときの既定は「何も飛ばしていない」
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

    /// 最後に確認が通った時刻（UNIX ミリ秒）。
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

/// `updater.json` を読む。無いか、読めないか、壊れていれば既定値。`Err` は `app_config_dir` を
/// 引けないときだけ。
///
/// 壊れていても `Err` を返さない。呼び出し元は更新の告知を出す側で、ここが読めないことを
/// 利用者に見せる意味が無い。既定値は「何も飛ばしていない」なので、壊れたときに倒れる先は
/// **告知が出る**側になる。
pub fn read_or_default<R: Runtime>(app: &AppHandle<R>) -> Result<UpdaterState, String> {
    read_file_or_default(&updater_path(app)?)
}

fn read_file_or_default(path: &Path) -> Result<UpdaterState, String> {
    if !path.exists() {
        return Ok(UpdaterState::default());
    }
    let Ok(data) = fs::read_to_string(path) else {
        return Ok(UpdaterState::default());
    };
    Ok(serde_json::from_str(&data).unwrap_or_default())
}

/// `updater.json` をファイルごと原子的に置き換える
pub fn write<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState) -> Result<(), String> {
    write_file(&updater_path(app)?, state)
}

fn write_file(path: &Path, state: &UpdaterState) -> Result<(), String> {
    let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    atomic_write(path, data.as_bytes()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(tag: &str) -> PathBuf {
        test_support::dir::temp_dir(tag)
    }

    /// 無い、壊れた、読めない `updater.json` は、どれも既定値（何も飛ばしていない）で読む。
    /// `Err` を返すと、更新の告知を出す側が止まる。読めないのは、ファイルの名前にフォルダを置いて作る
    #[test]
    fn a_missing_broken_or_unreadable_file_reads_as_default() {
        let dir = dir("updater-read");
        let path = dir.join(UPDATER_FILE);
        assert_eq!(read_file_or_default(&path).unwrap().skipped_version, None);

        fs::write(&path, r#"{"skippedVersion": "#).unwrap();
        assert_eq!(read_file_or_default(&path).unwrap().skipped_version, None);

        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(read_file_or_default(&path).unwrap().skipped_version, None);
        let _ = fs::remove_dir_all(&dir);
    }

    /// 書いたものを読み直せる。欄は camelCase で、TS（`src/entities/updater`）がこの綴りで読む
    #[test]
    fn a_written_file_reads_back_in_the_wire_spelling() {
        let dir = dir("updater-round-trip");
        let path = dir.join(UPDATER_FILE);
        let state = UpdaterState {
            skipped_version: Some("0.9.0".to_string()),
            last_checked_ms: Some(1_700_000_000_000),
        };

        write_file(&path, &state).unwrap();

        let written: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(written["skippedVersion"], "0.9.0");
        let read = read_file_or_default(&path).unwrap();
        assert_eq!(read.skipped_version.as_deref(), Some("0.9.0"));
        assert_eq!(read.last_checked_ms, Some(1_700_000_000_000));
        let _ = fs::remove_dir_all(&dir);
    }
}
