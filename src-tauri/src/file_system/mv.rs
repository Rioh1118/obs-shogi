use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Runtime};

use crate::file_system::error::{FsError, FsErrorCode};
use crate::file_system::utils::{
    ensure_not_exists, is_move_into_itself, is_project_root, validate_basename, validate_under_root,
};

use super::utils::is_kifu_file;

// 行き先を呼び出し側から受けるのは `mv_kifu_file` / `mv_directory` の2つ。
// `rename_*` の行き先は `src.parent().join(name)` で導出する。`validate_basename` が
// 区切り文字を弾くので、src が root の**配下**（root 自身を除く）なら行き先も root 配下。
// root 自身の改名だけは行き先が root の兄弟になるので、`is_project_root` で分岐する。
//
// **関門はどれも存在確認より先に置く。** 後ろに置くと、root 外のパスが在るかどうかを
// 返ってくる code で判別できてしまう。順序の理由は `validate_under_root` に書いてある

#[command]
pub fn rename_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    file_path: String,
    new_file_name: String,
) -> Result<String, FsError> {
    let src = PathBuf::from(&file_path);

    validate_under_root(&app, &src)?;
    if !src.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }
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

    validate_under_root(&app, &src)?;
    if !src.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }
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

    validate_under_root(&app, &src)?;
    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(dir_path),
        );
    }
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

    // ワークスペースそのものの改名だけは、行き先が root の**兄弟**になるので
    // 関門に必ず落ちる。外して通す。`validate_basename` が区切り文字を弾いており、
    // 行き先は `parent.join(name)` なので、root の親の直下から出ることはない
    if !is_project_root(&app, &src)? {
        validate_under_root(&app, &dest)?;
    }
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

    validate_under_root(&app, &src)?;
    if !src.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "directory does not exist").with_path(dir_path),
        );
    }
    if !src.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidType, "path is not a directory")
                .with_path(src.to_string_lossy().to_string()),
        );
    }

    let dest_parent = PathBuf::from(&dest_parent_dir);
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
    // 自分の中へは動かせない。ここで止めないと `fs::rename` が EINVAL を返し、
    // `io`（「読み書きに失敗しました」/ tier は warning）に丸まる。
    // 何度読み直しても同じなので、利用者は効かない再読み込みを押し続ける
    if is_move_into_itself(&src, &dest) {
        return Err(FsError::new(
            FsErrorCode::InvalidDestination,
            "cannot move a directory into itself",
        )
        .with_path(dest.to_string_lossy().to_string()));
    }
    ensure_not_exists(&dest)?;

    fs::rename(&src, &dest).map_err(FsError::from)?;
    Ok(dest.to_string_lossy().to_string())
}
