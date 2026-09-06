//! エンジン本体の置き場（`<ai_root>/engines`）。

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

use super::dir::{kind_of, FsKind};

/// エンジンの置き場。**AI のプロファイル名として使えない。**
///
/// `profile::read_all` がこの名前を一覧から除くので、作れても出てこない。
/// 除く側と弾く側で綴りが分かれると、作成は通るのに一覧に出ないフォルダができる
pub const ENGINES_DIR: &str = "engines";

#[derive(Debug, Clone, Serialize)]
pub struct EngineCandidate {
    /// engines/ 以下のエントリ名（ファイル名）
    pub entry: String,
    /// フルパス
    pub path: String,
    pub kind: FsKind,
}

/// engines/ 以下を列挙。YaneuraOu* のみに絞る。
pub fn read_all(engines_dir: &Path) -> Result<Vec<EngineCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(engines_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.is_empty() {
            continue;
        }

        if !file_name.starts_with("YaneuraOu") {
            continue;
        }

        let path = entry.path();
        let kind = kind_of(&path);

        out.push(EngineCandidate {
            entry: file_name,
            path: path.to_string_lossy().to_string(),
            kind,
        });
    }

    out.sort_by(|a, b| a.entry.cmp(&b.entry));
    Ok(out)
}

/// 置き場が無ければ作る。既にあれば、そこがディレクトリであることだけ確かめる。
pub fn ensure(ai_root: &Path) -> Result<PathBuf, String> {
    let engines_dir = ai_root.join(ENGINES_DIR);
    if engines_dir.exists() {
        if !engines_dir.is_dir() {
            return Err(format!(
                "engines exists but is not a directory: {}",
                engines_dir.display()
            ));
        }
        return Ok(engines_dir);
    }

    fs::create_dir_all(&engines_dir).map_err(|e| e.to_string())?;
    Ok(engines_dir)
}
