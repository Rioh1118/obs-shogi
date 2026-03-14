use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

use crate::file_system::error::{FsError, FsErrorCode};

use super::types::FileTreeNode;
use super::utils::{generate_id, get_file_extension, is_kifu_file};

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

#[command]
pub fn get_file_tree(root_dir: String) -> Result<FileTreeNode, FsError> {
    let root_path = PathBuf::from(&root_dir);

    if !root_path.exists() {
        return Err(FsError::new(
            FsErrorCode::NotFound,
            "指定されたディレクトリが存在しません",
        )
        .with_path(root_dir));
    }

    if !root_path.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはディレクトリではありません",
        )
        .with_path(root_path.to_string_lossy().to_string()));
    }

    // 絶対パスに正規化
    let canonical_path = root_path.canonicalize().map_err(FsError::from)?;
    build_file_tree_recursive(&canonical_path)
}
