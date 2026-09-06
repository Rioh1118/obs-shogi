//! ワークスペースの中のディレクトリとファイルを作る・消すコマンド。

use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Runtime};

use crate::workspace::guard::{is_project_root, validate_under_root};
use ::fs::error::{FsError, FsErrorCode};
use ::fs::path::{ensure_not_exists, is_kifu_file, validate_basename};

#[command]
pub fn create_directory<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    dir_name: String,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    let dir_name = validate_basename(&dir_name)?;

    let new_dir_path = parent_path.join(&dir_name);
    validate_under_root(&app, &new_dir_path)?;
    ensure_not_exists(&new_dir_path)?;

    fs::create_dir(&new_dir_path).map_err(FsError::from)?;

    Ok(new_dir_path.to_string_lossy().to_string())
}

#[command]
pub fn delete_file<R: Runtime>(app: AppHandle<R>, file_path: String) -> Result<(), FsError> {
    let path = PathBuf::from(&file_path);
    validate_under_root(&app, &path)?;

    if !path.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }

    if !path.is_file() {
        return Err(FsError::new(FsErrorCode::InvalidType, "path is not a file")
            .with_path(path.to_string_lossy().to_string()));
    }

    // 棋譜ファイルのみ削除許可
    if !is_kifu_file(&path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    fs::remove_file(path).map_err(FsError::from)
}

#[command]
pub fn delete_directory<R: Runtime>(app: AppHandle<R>, dir_path: String) -> Result<(), FsError> {
    let path = PathBuf::from(&dir_path);
    validate_under_root(&app, &path)?;

    // ワークスペースそのものは消させない。`remove_dir_all` は中身ごと消し、
    // 取り消す手段が無い。UI 側にも判定はあるが、**取り消せない操作を UI の判定だけに
    // 預けない**。webview から直に invoke されても、UI の判定を消す変更が入っても
    // 壊れない層に置く
    if is_project_root(&app, &path)? {
        return Err(FsError::new(
            FsErrorCode::RootNotDeletable,
            "cannot delete the project root",
        )
        .with_path(dir_path));
    }

    if !path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(dir_path),
        );
    }

    if !path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    fs::remove_dir_all(path).map_err(FsError::from)
}
