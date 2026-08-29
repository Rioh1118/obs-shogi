use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Runtime};

use crate::file_system::error::{FsError, FsErrorCode};
use crate::file_system::utils::{ensure_not_exists, validate_basename, validate_under_root};

use super::utils::is_kifu_file;

// この4つは**既存のパス(src)と行き先(dest)の2つを同時に受ける**唯一のコマンド群。
// root 配下かの関門は両方に要る。dest だけだと root 外から引き込め、
// src だけだと root 外へ出せる

#[command]
pub fn rename_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    new_file_name: String,
) -> Result<String, FsError> {
    let src = PathBuf::from(&file_path);

    // 存在確認を先に置く。root 検査を先にすると、親ごと消えた場合に
    // canonicalize が ENOENT で落ち、どのファイルの話かが表示から消える
    if !src.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }
    validate_under_root(&app, &src)?;
    if !src.is_file() {
        return Err(FsError::new(FsErrorCode::InvalidType, "path is not a file")
            .with_path(src.to_string_lossy().to_string()));
    }
    if !is_kifu_file(&src) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file")
                .with_path(src.to_string_lossy().to_string()),
        );
    }

    let new_file_name = validate_basename(&new_file_name)?;

    let parent = src.parent().ok_or_else(|| {
        FsError::new(FsErrorCode::InvalidPath, "cannot resolve parent directory")
            .with_path(src.to_string_lossy().to_string())
    })?;
    let dest = parent.join(&new_file_name);

    // リネーム後も棋譜拡張子のみ許可（拡張子変更を防ぐ）
    if !is_kifu_file(&dest) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(dest.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &dest)?;
    ensure_not_exists(&dest)?;

    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn mv_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    dest_dir: String,
    new_file_name: Option<String>,
) -> Result<String, FsError> {
    let src = PathBuf::from(&file_path);

    // 存在確認を先に置く。root 検査を先にすると、親ごと消えた場合に
    // canonicalize が ENOENT で落ち、どのファイルの話かが表示から消える
    if !src.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }
    validate_under_root(&app, &src)?;
    if !src.is_file() {
        return Err(FsError::new(FsErrorCode::InvalidType, "path is not a file")
            .with_path(src.to_string_lossy().to_string()));
    }
    if !is_kifu_file(&src) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file")
                .with_path(src.to_string_lossy().to_string()),
        );
    }

    let dest_dir = PathBuf::from(&dest_dir);
    // 存在確認より先に通す。後ろに置くと、root 外のパスの有無を
    // invalid_destination か invalid_path かで判別できてしまう
    validate_under_root(&app, &dest_dir)?;
    if !dest_dir.exists() || !dest_dir.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidDestination,
            "destination directory does not exist",
        )
        .with_path(dest_dir.to_string_lossy().to_string()));
    }

    let name = match new_file_name {
        Some(n) => validate_basename(&n)?,
        None => src
            .file_name()
            .ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "cannot resolve file name"))?
            .to_string_lossy()
            .to_string(),
    };

    let dest = dest_dir.join(&name);

    // 移動後も棋譜拡張子のみ許可
    if !is_kifu_file(&dest) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(dest.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &dest)?;
    ensure_not_exists(&dest)?;
    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn rename_directory<R: Runtime>(
    app: AppHandle<R>,
    dir_path: String,
    new_dir_name: String,
) -> Result<String, FsError> {
    let src = PathBuf::from(&dir_path);

    // 存在確認を先に置く（上と同じ理由）
    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(dir_path),
        );
    }
    validate_under_root(&app, &src)?;
    if !src.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(src.to_string_lossy().to_string()),
        );
    }

    let new_dir_name = validate_basename(&new_dir_name)?;

    let parent = src.parent().ok_or_else(|| {
        FsError::new(FsErrorCode::InvalidPath, "cannot resolve parent directory")
            .with_path(src.to_string_lossy().to_string())
    })?;
    let dest = parent.join(&new_dir_name);

    validate_under_root(&app, &dest)?;
    ensure_not_exists(&dest)?;

    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn mv_directory<R: Runtime>(
    app: AppHandle<R>,
    dir_path: String,
    dest_parent_dir: String,
    new_dir_name: Option<String>,
) -> Result<String, FsError> {
    let src = PathBuf::from(&dir_path);

    // 存在確認を先に置く（上と同じ理由）
    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(dir_path),
        );
    }
    validate_under_root(&app, &src)?;
    if !src.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(src.to_string_lossy().to_string()),
        );
    }

    let dest_parent = PathBuf::from(&dest_parent_dir);
    // 存在確認より先に通す（上と同じ理由）
    validate_under_root(&app, &dest_parent)?;
    if !dest_parent.exists() || !dest_parent.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidDestination,
            "destination directory does not exist",
        )
        .with_path(dest_parent.to_string_lossy().to_string()));
    }

    let name = match new_dir_name {
        Some(n) => validate_basename(&n)?,
        None => src
            .file_name()
            .ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "cannot resolve directory name"))?
            .to_string_lossy()
            .to_string(),
    };

    let dest = dest_parent.join(&name);

    validate_under_root(&app, &dest)?;
    ensure_not_exists(&dest)?;

    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}
