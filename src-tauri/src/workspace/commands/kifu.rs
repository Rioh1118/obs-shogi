//! ワークスペースの中の棋譜ファイルを読み書きするコマンド。

use std::path::PathBuf;
use tauri::{command, AppHandle, Runtime};

use shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;

use crate::workspace::guard::validate_under_root;
use crate::workspace::record::{read_text_portable, spell_for_extension, write_new_file};
use ::fs::error::{FsError, FsErrorCode};
use ::fs::path::{is_kifu_file, validate_basename};
use ::fs::write::atomic_write;

#[command]
pub fn read_file<R: Runtime>(app: AppHandle<R>, file_path: String) -> Result<String, FsError> {
    let path = PathBuf::from(&file_path);
    validate_under_root(&app, &path)?;

    if !path.exists() {
        return Err(FsError::new(FsErrorCode::NotFound, "file does not exist").with_path(file_path));
    }

    if !path.is_file() {
        return Err(FsError::new(FsErrorCode::InvalidType, "path is not a file")
            .with_path(path.to_string_lossy().to_string()));
    }

    // 棋譜ファイルのみ読み込み許可
    if !is_kifu_file(&path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    read_text_portable(&path)
}

#[command]
pub fn create_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    file_name: String,
    mut jkf_data: JsonKifuFormat,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    let file_name = validate_basename(&file_name)?;

    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(file_path.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &file_path)?;

    // ここに来る JKF は webview 側が組んだもので、パーサ由来ではない。
    // `parse_*` の戻り値なら正規化済みだが、この経路はそうではないので呼ぶ。
    // なお `import_kifu_file` と `write_kifu_to_file` は呼ばない（#322）
    jkf_data.normalize().map_err(|e| {
        FsError::new(
            FsErrorCode::KifuConversionFailed,
            format!("normalize failed: {e}"),
        )
    })?;

    let content = spell_for_extension(&jkf_data, &file_path)?;

    write_new_file(&file_path, &content)?;

    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn import_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    file_name: String,
    jkf_data: JsonKifuFormat,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    let file_name = validate_basename(&file_name)?;

    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(file_path.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &file_path)?;

    let content = spell_for_extension(&jkf_data, &file_path)?;

    write_new_file(&file_path, &content)?;

    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn save_kifu_file<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    file_name: String,
    content: String,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "parent directory does not exist")
                .with_path(parent_dir),
        );
    }

    // パスは検証を通した名前から組む。生の名前で先に組むと、検証した文字列と
    // 実際に書き込む先が別のものになる
    let file_name = validate_basename(&file_name)?;
    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "not a kifu file extension")
                .with_path(file_path.to_string_lossy().to_string()),
        );
    }

    validate_under_root(&app, &file_path)?;

    // ファイル保存（atomic write でクラッシュ時の半端な状態を避ける）
    atomic_write(&file_path, content.as_bytes()).map_err(FsError::from)?;

    Ok(file_path.to_string_lossy().to_string())
}
