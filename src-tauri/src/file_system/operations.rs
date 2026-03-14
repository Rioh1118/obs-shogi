use crate::file_system::{
    error::{FsError, FsErrorCode},
    utils::{ensure_not_exists, validate_basename},
};
use std::io::Write;

use super::utils::{get_file_extension, is_kifu_file};
use shogi_kifu_converter::{
    converter::{ToCsa, ToKi2, ToKif},
    jkf::JsonKifuFormat,
};
use std::{fs::OpenOptions, path::PathBuf};
use tauri::command;

use encoding_rs::SHIFT_JIS;
use std::{fs, path::Path};

fn write_new_file(path: &Path, content: &str) -> Result<(), FsError> {
    ensure_not_exists(path)?;

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(FsError::from)?;

    file.write_all(content.as_bytes()).map_err(FsError::from)
}

fn read_text_portable(path: &Path) -> Result<String, FsError> {
    let bytes = fs::read(path).map_err(FsError::from)?;
    let bytes = strip_utf8_bom(&bytes);

    // 1) UTF-8
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Ok(s.to_string());
    }

    // 2) Shift_JIS
    {
        let (cow, _, _had_errors) = SHIFT_JIS.decode(bytes);
        Ok(cow.into_owned())
    }
}

fn strip_utf8_bom(bytes: &[u8]) -> &[u8] {
    const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
    if bytes.starts_with(&BOM) {
        &bytes[3..]
    } else {
        bytes
    }
}

#[command]
pub fn read_file(file_path: String) -> Result<String, FsError> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "ファイルが存在しません").with_path(file_path),
        );
    }

    if !path.is_file() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはファイルではありません",
        )
        .with_path(path.to_string_lossy().to_string()));
    }

    // 棋譜ファイルのみ読み込み許可
    if !is_kifu_file(&path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "棋譜ファイルではありません")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    read_text_portable(&path)
}

#[command]
pub fn create_kifu_file(
    parent_dir: String,
    file_name: String,
    mut jkf_data: JsonKifuFormat,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidPath, "親ディレクトリが存在しません")
                .with_path(parent_dir),
        );
    }

    validate_basename(&file_name)?;

    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(FsError::new(
            FsErrorCode::InvalidExtension,
            "棋譜ファイルの拡張子ではありません",
        )
        .with_path(file_path.to_string_lossy().to_string()));
    }

    // JKFデータを正規化
    jkf_data
        .normalize()
        .map_err(|e| FsError::new(FsErrorCode::InvalidType, format!("正規化エラー: {:?}", e)))?;

    // ファイル拡張子に応じて適切な形式に変換
    let content = match get_file_extension(&file_path).as_deref() {
        Some("kif") => jkf_data.to_kif_owned(),
        Some("ki2") => jkf_data.to_ki2_owned(),
        Some("csa") => jkf_data.to_csa_owned(),
        Some("jkf") => serde_json::to_string_pretty(&jkf_data)
            .map_err(|e| FsError::new(FsErrorCode::InvalidType, e.to_string()))?,
        _ => {
            return Err(
                FsError::new(FsErrorCode::InvalidExtension, "未対応の形式です")
                    .with_path(file_path.to_string_lossy().to_string()),
            )
        }
    };

    // ファイル保存
    write_new_file(&file_path, &content)?;

    // 保存したファイルのパスを返す
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn import_kifu_file(
    parent_dir: String,
    file_name: String,
    jkf_data: JsonKifuFormat,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);

    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidPath, "親ディレクトリが存在しません")
                .with_path(parent_dir),
        );
    }

    validate_basename(&file_name)?;

    let file_path = parent_path.join(&file_name);

    if !is_kifu_file(&file_path) {
        return Err(FsError::new(
            FsErrorCode::InvalidExtension,
            "棋譜ファイルの拡張子ではありません",
        )
        .with_path(file_path.to_string_lossy().to_string()));
    }

    // ファイル拡張子に応じて適切な形式に変換
    let content = match get_file_extension(&file_path).as_deref() {
        Some("kif") => jkf_data.to_kif_owned(),
        Some("ki2") => jkf_data.to_ki2_owned(),
        Some("csa") => jkf_data.to_csa_owned(),
        Some("jkf") => serde_json::to_string_pretty(&jkf_data)
            .map_err(|e| FsError::new(FsErrorCode::InvalidType, e.to_string()))?,
        _ => {
            return Err(
                FsError::new(FsErrorCode::InvalidExtension, "未対応の形式です")
                    .with_path(file_path.to_string_lossy().to_string()),
            )
        }
    };

    // ファイル保存
    write_new_file(&file_path, &content)?;

    // 保存したファイルのパスを返す
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn save_kifu_file(
    parent_dir: String,
    file_name: String,
    content: String,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    let file_path = parent_path.join(&file_name);

    // 親ディレクトリの存在確認
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidPath, "親ディレクトリが存在しません")
                .with_path(parent_dir),
        );
    }

    validate_basename(&file_name)?;

    if !is_kifu_file(&file_path) {
        return Err(FsError::new(
            FsErrorCode::InvalidExtension,
            "棋譜ファイルの拡張子ではありません",
        )
        .with_path(file_path.to_string_lossy().to_string()));
    }

    // ファイル保存
    fs::write(&file_path, content).map_err(FsError::from)?;

    // 保存したファイルのパスを返す
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn create_directory(parent_dir: String, dir_name: String) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);

    // 親ディレクトリの存在確認
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(
            FsError::new(FsErrorCode::InvalidPath, "親ディレクトリが存在しません")
                .with_path(parent_dir),
        );
    }

    validate_basename(&dir_name)?;

    let new_dir_path = parent_path.join(&dir_name);
    ensure_not_exists(&new_dir_path)?;

    fs::create_dir(&new_dir_path).map_err(FsError::from)?;

    // 作成したディレクトリのパスを返す
    Ok(new_dir_path.to_string_lossy().to_string())
}

#[command]
pub fn delete_file(file_path: String) -> Result<(), FsError> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "ファイルが存在しません").with_path(file_path),
        );
    }

    if !path.is_file() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはファイルではありません",
        )
        .with_path(path.to_string_lossy().to_string()));
    }

    // 棋譜ファイルのみ削除許可
    if !is_kifu_file(&path) {
        return Err(
            FsError::new(FsErrorCode::InvalidExtension, "棋譜ファイルではありません")
                .with_path(path.to_string_lossy().to_string()),
        );
    }

    fs::remove_file(path).map_err(FsError::from)
}

#[command]
pub fn delete_directory(dir_path: String) -> Result<(), FsError> {
    let path = PathBuf::from(&dir_path);

    if !path.exists() {
        return Err(
            FsError::new(FsErrorCode::NotFound, "ディレクトリが存在しません").with_path(dir_path),
        );
    }

    if !path.is_dir() {
        return Err(FsError::new(
            FsErrorCode::InvalidType,
            "指定されたパスはディレクトリではありません",
        )
        .with_path(path.to_string_lossy().to_string()));
    }

    fs::remove_dir_all(path).map_err(FsError::from)
}
