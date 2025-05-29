use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

use super::types::{FileMeta, FileTreeNode};
use super::utils::{generate_id, get_file_type, get_icon_type};

fn build_file_tree_recursive(path: &Path, root_path: &Path) -> Result<FileTreeNode, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let is_dir = metadata.is_dir();
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let absolute_path = path.to_string_lossy().to_string();

    let file_type = if is_dir {
        "folder".to_string()
    } else {
        get_file_type(path)
    };

    let icon_type = get_icon_type(is_dir, &file_type);

    let mut node = FileTreeNode {
        id: generate_id(),
        name,
        path: absolute_path,
        is_dir,
        children: None,
        meta: Some(FileMeta {
            file_type: if is_dir { None } else { Some(file_type) },
            icon_type: Some(icon_type),
        }),
    };

    if is_dir {
        let mut children = Vec::new();
        let entries = fs::read_dir(path).map_err(|e| e.to_string())?;

        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let child_path = entry.path();

            match build_file_tree_recursive(&child_path, root_path) {
                Ok(child_node) => children.push(child_node),
                Err(_) => continue,
            }
        }

        // ディレクトリを先に、その後ファイルの名前順でソート
        children.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.cmp(&b.name),
        });

        if !children.is_empty() {
            node.children = Some(children)
        }
    }
    Ok(node)
}

#[command]
pub fn get_file_tree(root_dir: String) -> Result<FileTreeNode, String> {
    let root_path = PathBuf::from(&root_dir);

    if !root_path.exists() {
        return Err(format!(
            "指定されたディレクトリが存在しません: {}",
            root_dir
        ));
    }

    if !root_path.is_dir() {
        return Err(format!(
            "指定されたパスはディレクトリではありません: {}",
            root_dir
        ));
    }

    // 絶対パスに正規化
    let canonical_path = root_path.canonicalize().map_err(|e| e.to_string())?;

    build_file_tree_recursive(&canonical_path, &canonical_path)
}
