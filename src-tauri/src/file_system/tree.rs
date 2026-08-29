use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, AppHandle, Runtime};

use crate::file_system::error::{FsError, FsErrorCode};

use super::types::FileTreeNode;
use super::utils::{generate_id, get_file_extension, is_kifu_file, validate_under_root};

// TODO(#215): 循環と深さの止めが無い。root 配下に自分を指す symlink が1つあると
// スタックオーバーフローでプロセスごと落ちる（起動のたびに走るので復旧できない）
fn build_file_tree_recursive(path: &Path) -> Result<FileTreeNode, FsError> {
    let metadata = fs::metadata(path).map_err(FsError::from)?;
    let is_dir = metadata.is_dir();

    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let absolute_path = path.to_string_lossy().to_string();

    let mut node = FileTreeNode {
        id: generate_id(),
        name,
        path: absolute_path,
        is_dir,
        children: None,
        last_modified: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64),
        size: if is_dir { None } else { Some(metadata.len()) },
        extension: if is_dir {
            None
        } else {
            get_file_extension(path)
        },
    };

    if is_dir {
        let mut children = Vec::new();
        let entries = fs::read_dir(path).map_err(FsError::from)?;

        for entry in entries {
            let entry = match entry {
                Ok(v) => v,
                Err(_) => continue,
            };
            let child_path = entry.path();

            // ディレクトリまたは棋譜ファイルのみを含める
            if child_path.is_dir() || is_kifu_file(&child_path) {
                match build_file_tree_recursive(&child_path) {
                    Ok(child_node) => children.push(child_node),
                    Err(_) => continue, // エラーは無視して続行
                }
            }
        }

        // ディレクトリを先に、その後ファイルの名前順でソート
        children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        if !children.is_empty() {
            node.children = Some(children);
        }
    }

    Ok(node)
}

/// ツリーの取得。**`root_dir` は呼び出し側から来るので、設定値と突き合わせる。**
///
/// 突き合わせないと `invoke("get_file_tree", { rootDir: "/Users/x" })` で
/// ホーム以下の全ディレクトリ名・棋譜のフルパス・サイズ・更新時刻が返る。
/// 中身は `read_file` が `validate_under_root` で守っているが、一覧は素通りになる。
#[command]
pub fn get_file_tree<R: Runtime>(
    app: AppHandle<R>,
    root_dir: String,
) -> Result<FileTreeNode, FsError> {
    let root_path = PathBuf::from(&root_dir);
    validate_under_root(&app, &root_path)?;

    if !root_path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(root_dir),
        );
    }

    if !root_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(root_path.to_string_lossy().to_string()),
        );
    }

    // 絶対パスに正規化
    let canonical_path = root_path.canonicalize().map_err(FsError::from)?;
    build_file_tree_recursive(&canonical_path)
}
