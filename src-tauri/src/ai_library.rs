use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::command;

use crate::file_system::utils::validate_basename;

/// エンジンの置き場。**AI のプロファイル名として使えない。**
///
/// `read_profiles` がこの名前を一覧から除くので、作れても出てこない。
/// 除く側と弾く側で綴りが分かれると、作成は通るのに一覧に出ないフォルダができる
const ENGINES_DIR: &str = "engines";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsKind {
    File,
    Dir,
    Symlink,
    Unknown,
}

fn validate_dir(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    let p = Path::new(value);
    if !p.exists() {
        return Err(format!("{label} does not exist: {value}"));
    }
    if !p.is_dir() {
        return Err(format!("{label} is not a directory: {value}"));
    }
    Ok(())
}

fn kind_of(path: &Path) -> FsKind {
    match fs::symlink_metadata(path) {
        Ok(md) => {
            let ft = md.file_type();
            if ft.is_symlink() {
                FsKind::Symlink
            } else if ft.is_dir() {
                FsKind::Dir
            } else if ft.is_file() {
                FsKind::File
            } else {
                FsKind::Unknown
            }
        }
        Err(_) => FsKind::Unknown,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AiRootIndex {
    pub ai_root: String,

    pub engines_dir: DirInfo,
    pub engines: Vec<EngineCandidate>,

    pub profiles: Vec<ProfileCandidate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DirInfo {
    pub path: String,
    pub exists: bool,
    pub kind: FsKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineCandidate {
    /// engines/ 以下のエントリ名（ファイル名）
    pub entry: String,
    /// フルパス
    pub path: String,
    pub kind: FsKind,
}

/// eval/ や book/ のファイル候補
#[derive(Debug, Clone, Serialize)]
pub struct FileCandidate {
    pub entry: String, // ファイル名
    pub path: String,  // フルパス
    pub kind: FsKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileCandidate {
    /// ai_root 直下のディレクトリ名（= profile 名）
    pub name: String,
    /// profile ディレクトリのフルパス
    pub path: String,

    pub has_eval_dir: bool,
    pub has_book_dir: bool,

    /// eval/ 配下のファイル候補（フルパス）
    pub eval_files: Vec<FileCandidate>,
    /// book/ 配下の .db ファイル候補（フルパス）
    pub book_db_files: Vec<FileCandidate>,
}

#[command]
pub fn scan_ai_root(ai_root: String) -> Result<AiRootIndex, String> {
    validate_dir("ai_root", &ai_root)?;
    let root = PathBuf::from(&ai_root);

    let engines_dir_path = root.join(ENGINES_DIR);
    let engines_dir_exists = engines_dir_path.exists();
    let engines_dir_kind = if engines_dir_exists {
        kind_of(&engines_dir_path)
    } else {
        FsKind::Unknown
    };

    let engines = if engines_dir_exists && engines_dir_path.is_dir() {
        read_engines(&engines_dir_path)?
    } else {
        vec![]
    };

    let profiles = read_profiles(&root)?;

    Ok(AiRootIndex {
        ai_root,
        engines_dir: DirInfo {
            path: engines_dir_path.to_string_lossy().to_string(),
            exists: engines_dir_exists,
            kind: engines_dir_kind,
        },
        engines,
        profiles,
    })
}

/// engines/ 以下を列挙。YaneuraOu* のみに絞る。
fn read_engines(engines_dir: &Path) -> Result<Vec<EngineCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(engines_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.is_empty() {
            continue;
        }

        // ここが要件：YaneuraOu で始まるものだけ
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

fn read_profiles(ai_root: &Path) -> Result<Vec<ProfileCandidate>, String> {
    let mut out = vec![];

    for entry in fs::read_dir(ai_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.is_empty() || name == ENGINES_DIR {
            continue;
        }

        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let eval_dir = path.join("eval");
        let book_dir = path.join("book");

        let has_eval_dir = eval_dir.exists() && eval_dir.is_dir();
        let has_book_dir = book_dir.exists() && book_dir.is_dir();

        // 候補として出す条件（現状維持）:
        // eval/ または book/ があるディレクトリだけ
        if !(has_eval_dir || has_book_dir) {
            continue;
        }

        let eval_files = if has_eval_dir {
            list_file_candidates(&eval_dir, None, 200)
        } else {
            vec![]
        };

        // book は .db のみ
        let book_db_files = if has_book_dir {
            list_file_candidates(&book_dir, Some("db"), 200)
        } else {
            vec![]
        };

        out.push(ProfileCandidate {
            name,
            path: path.to_string_lossy().to_string(),
            has_eval_dir,
            has_book_dir,
            eval_files,
            book_db_files,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// dir 内のファイル候補を列挙（フルパス）。
/// ext_filter: Some("db") なら拡張子 db のみ
fn list_file_candidates(dir: &Path, ext_filter: Option<&str>, max: usize) -> Vec<FileCandidate> {
    let mut out: Vec<FileCandidate> = vec![];

    let it = match fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return out,
    };

    for entry in it.take(max) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let kind = kind_of(&path);

        // file/symlink のみ採用（dir は除外）
        match kind {
            FsKind::File | FsKind::Symlink => {}
            _ => continue,
        }

        if let Some(ext) = ext_filter {
            let ok = path
                .extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case(ext))
                .unwrap_or(false);
            if !ok {
                continue;
            }
        }

        let entry_name = entry.file_name().to_string_lossy().to_string();

        out.push(FileCandidate {
            entry: entry_name,
            path: path.to_string_lossy().to_string(),
            kind,
        });
    }

    out.sort_by(|a, b| a.entry.cmp(&b.entry));
    out
}

/// AI プロファイル（`<ai_root>/<name>/{eval,book}`）を作る。
///
/// **`create_directory` は使えない。** あちらはワークスペース配下かの関門を通るが、
/// `ai_root` は利用者が別に選ぶ場所で、ワークスペースの外にある。
/// 関門つきのコマンドで作ろうとすると、ワークスペースを設定済みの利用者は
/// 必ず `invalid_path`（「その場所は扱えません」）で弾かれる
#[command]
pub fn create_ai_profile_dirs(ai_root: String, name: String) -> Result<String, String> {
    validate_dir("ai_root", &ai_root)?;

    // **名前の規則は写さない。** ここで書き直すと、`.` と `..` のような
    // 1つの規則を落としたときに `ai_root` の外へ作れてしまう
    // （`join("..")` は親へ抜ける。`create_dir_all` は途中の段も黙って作る）
    let trimmed = validate_basename(&name).map_err(|e| e.message)?;

    // `engines` は `read_profiles` が一覧から除く名前なので、作れても出てこない。
    // 「作成は通ったのに一覧に無い」は、利用者からは作成の失敗と区別が付かない
    if trimmed == ENGINES_DIR {
        return Err(format!(
            "{ENGINES_DIR} はエンジンの置き場なので、名前に使えません"
        ));
    }

    let profile = PathBuf::from(&ai_root).join(&trimmed);

    // 既にあるなら作らない。`create_dir_all` は既存のフォルダでも `Ok` を返すので、
    // 素通しにすると別の AI の `eval` / `book` へ黙って合流する
    if profile.exists() {
        return Err(format!("{trimmed} はすでにあります"));
    }

    for sub in ["eval", "book"] {
        fs::create_dir_all(profile.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(profile.to_string_lossy().to_string())
}

#[command]
pub fn ensure_engines_dir(ai_root: String) -> Result<String, String> {
    validate_dir("ai_root", &ai_root)?;
    let root = PathBuf::from(&ai_root);

    let engines_dir = root.join(ENGINES_DIR);
    if engines_dir.exists() {
        if !engines_dir.is_dir() {
            return Err(format!(
                "engines exists but is not a directory: {}",
                engines_dir.display()
            ));
        }
        return Ok(engines_dir.to_string_lossy().to_string());
    }

    fs::create_dir_all(&engines_dir).map_err(|e| e.to_string())?;
    Ok(engines_dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("obs-shogi-ai-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("作れない");
        dir
    }

    fn create(root: &Path, name: &str) -> Result<String, String> {
        create_ai_profile_dirs(root.to_string_lossy().to_string(), name.to_string())
    }

    /// `..` を通すと `ai_root` の外へ作れる。名前の規則を写さず
    /// `validate_basename` を呼んでいることを、実際の入力で固定する
    #[test]
    fn a_profile_name_cannot_climb_out_of_the_ai_root() {
        let root = temp_root("climb");

        assert!(create(&root, "..").is_err(), "`..` を通している");
        assert!(create(&root, "a/b").is_err(), "区切りを通している");
        assert!(!root.join("../eval").exists(), "ai_root の外に作っている");

        let _ = fs::remove_dir_all(&root);
    }

    /// `read_profiles` が一覧から除く名前。作れても出てこないので、
    /// 利用者からは作成の失敗と区別が付かない
    #[test]
    fn the_engines_directory_is_not_a_profile_name() {
        let root = temp_root("engines");

        assert!(create(&root, ENGINES_DIR).is_err(), "engines を通している");
        assert!(!root.join(ENGINES_DIR).exists(), "engines を作っている");

        let _ = fs::remove_dir_all(&root);
    }

    /// `create_dir_all` は既存のフォルダでも `Ok` を返す。素通しにすると
    /// 別の AI の `eval` / `book` へ黙って合流する
    #[test]
    fn an_existing_profile_name_is_rejected_instead_of_merged() {
        let root = temp_root("dup");

        assert!(create(&root, "suisho").is_ok(), "1つ目を作れない");
        assert!(create(&root, "suisho").is_err(), "同じ名前で通している");

        let _ = fs::remove_dir_all(&root);
    }
}
