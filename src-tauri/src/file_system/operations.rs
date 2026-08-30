use crate::file_system::{
    error::{FsError, FsErrorCode},
    utils::{
        atomic_write, ensure_not_exists, is_project_root, validate_basename, validate_under_root,
    },
};
use std::io::Write;

use super::utils::{get_file_extension, is_kifu_file};
use shogi_kifu_converter_obsshogi::{
    converter::{ToCsa, ToKi2, ToKif},
    error::ConvertError,
    jkf::JsonKifuFormat,
};
use std::{fs::OpenOptions, path::PathBuf};
use tauri::{command, AppHandle, Runtime};

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

/// JKF データをファイル拡張子に応じた形式に変換する
fn convert_jkf_to_format(jkf_data: &JsonKifuFormat, file_path: &Path) -> Result<String, FsError> {
    // 綴れなかった理由は ConvertError の Display が言う（何手目の何の手か）。
    // ここで潰すと、利用者に出るのは「変換に失敗」だけになる
    let spell = |r: Result<String, ConvertError>| {
        r.map_err(|e| FsError::new(FsErrorCode::KifuConversionFailed, e.to_string()))
    };

    match get_file_extension(file_path).as_deref() {
        Some("kif") => spell(jkf_data.try_to_kif_owned()),
        Some("ki2") => spell(jkf_data.try_to_ki2_owned()),
        Some("csa") => spell(jkf_data.try_to_csa_owned()),
        Some("jkf") => serde_json::to_string_pretty(jkf_data)
            .map_err(|e| FsError::new(FsErrorCode::KifuConversionFailed, e.to_string())),
        _ => Err(
            FsError::new(FsErrorCode::InvalidExtension, "unsupported kifu format")
                .with_path(file_path.to_string_lossy().to_string()),
        ),
    }
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

    // JKFデータを正規化
    jkf_data.normalize().map_err(|e| {
        FsError::new(
            FsErrorCode::KifuConversionFailed,
            format!("normalize failed: {:?}", e),
        )
    })?;

    // ファイル拡張子に応じて適切な形式に変換
    let content = convert_jkf_to_format(&jkf_data, &file_path)?;

    // ファイル保存
    write_new_file(&file_path, &content)?;

    // 保存したファイルのパスを返す
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

    // ファイル拡張子に応じて適切な形式に変換
    let content = convert_jkf_to_format(&jkf_data, &file_path)?;

    // ファイル保存
    write_new_file(&file_path, &content)?;

    // 保存したファイルのパスを返す
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

    // 親ディレクトリの存在確認
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

    // 保存したファイルのパスを返す
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn create_directory<R: Runtime>(
    app: AppHandle<R>,
    parent_dir: String,
    dir_name: String,
) -> Result<String, FsError> {
    let parent_path = PathBuf::from(&parent_dir);
    validate_under_root(&app, &parent_path)?;

    // 親ディレクトリの存在確認
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

    // 作成したディレクトリのパスを返す
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
