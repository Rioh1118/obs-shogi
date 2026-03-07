use std::fs;
use std::path::PathBuf;
use tauri::command;

use crate::file_system::error::{FsError, FsErrorCode};
use crate::file_system::utils::{ensure_not_exists, validate_basename};

use super::utils::is_kifu_file;

#[command]
pub fn rename_kifu_file(file_path: String, new_file_name: String) -> Result<String, FsError> {
    let src = PathBuf::from(&file_path);

    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "ファイルが存在しません").with_path(file_path),
        );
    }
    if !src.is_file() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはファイルではありません",
        )
        .with_path(src.to_string_lossy().to_string()));
    }
    if !is_kifu_file(&src) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "棋譜ファイルではありません")
                .with_path(src.to_string_lossy().to_string()),
        );
    }

    validate_basename(&new_file_name)?;

    let parent = src.parent().ok_or_else(|| {
        FsError::new(FsErrorCode::InvalidPath, "親ディレクトリが取得できません")
            .with_path(src.to_string_lossy().to_string())
    })?;
    let dest = parent.join(&new_file_name);

    // リネーム後も棋譜拡張子のみ許可（拡張子変更を防ぐ）
    if !is_kifu_file(&dest) {
        return Err(FsError::new(
            FsErrorCode::InvalidExtension,
            "棋譜ファイルの拡張子ではありません",
        )
        .with_path(dest.to_string_lossy().to_string()));
    }

    ensure_not_exists(&dest)?;

    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn mv_kifu_file(
    file_path: String,
    dest_dir: String,
    new_file_name: Option<String>,
) -> Result<String, FsError> {
    let src = PathBuf::from(&file_path);

    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "ファイルが存在しません").with_path(file_path),
        );
    }
    if !src.is_file() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはファイルではありません",
        )
        .with_path(src.to_string_lossy().to_string()));
    }
    if !is_kifu_file(&src) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "棋譜ファイルではありません")
                .with_path(src.to_string_lossy().to_string()),
        );
    }

    let dest_dir = PathBuf::from(&dest_dir);
    if !dest_dir.exists() || !dest_dir.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidDestination,
            "移動先ディレクトリが存在しません",
        )
        .with_path(dest_dir.to_string_lossy().to_string()));
    }

    let name = match new_file_name {
        Some(n) => {
            validate_basename(&n)?;
            n
        }
        None => src
            .file_name()
            .ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "ファイル名が取得できません"))?
            .to_string_lossy()
            .to_string(),
    };

    let dest = dest_dir.join(&name);

    // 移動後も棋譜拡張子のみ許可
    if !is_kifu_file(&dest) {
        return Err(FsError::new(
            FsErrorCode::InvalidExtension,
            "棋譜ファイルの拡張子ではありません",
        )
        .with_path(dest.to_string_lossy().to_string()));
    }

    ensure_not_exists(&dest)?;
    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn rename_directory(dir_path: String, new_dir_name: String) -> Result<String, FsError> {
    let src = PathBuf::from(&dir_path);

    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "ディレクトリが存在しません").with_path(dir_path),
        );
    }
    if !src.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはディレクトリではありません",
        )
        .with_path(src.to_string_lossy().to_string()));
    }

    validate_basename(&new_dir_name)?;

    let parent = src.parent().ok_or_else(|| {
        FsError::new(FsErrorCode::InvalidPath, "親ディレクトリが取得できません")
            .with_path(src.to_string_lossy().to_string())
    })?;
    let dest = parent.join(&new_dir_name);

    ensure_not_exists(&dest)?;

    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn mv_directory(
    dir_path: String,
    dest_parent_dir: String,
    new_dir_name: Option<String>,
) -> Result<String, FsError> {
    let src = PathBuf::from(&dir_path);

    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "ディレクトリが存在しません").with_path(dir_path),
        );
    }
    if !src.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはディレクトリではありません",
        )
        .with_path(src.to_string_lossy().to_string()));
    }

    let dest_parent = PathBuf::from(&dest_parent_dir);
    if !dest_parent.exists() || !dest_parent.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidDestination,
            "移動先ディレクトリが存在しません",
        )
        .with_path(dest_parent.to_string_lossy().to_string()));
    }

    let name = match new_dir_name {
        Some(n) => {
            validate_basename(&n)?;
            n
        }
        None => src
            .file_name()
            .ok_or_else(|| {
                FsError::new(FsErrorCode::InvalidPath, "ディレクトリ名が取得できません")
            })?
            .to_string_lossy()
            .to_string(),
    };

    let dest = dest_parent.join(&name);

    ensure_not_exists(&dest)?;

    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}
