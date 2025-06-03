use std::fs;
use std::path::PathBuf;
use tauri::command;

use super::utils::is_kifu_file;

#[command]
pub fn read_file(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(format!("ファイルが存在しません: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!(
            "指定されたパスはファイルではありません: {}",
            path.display()
        ));
    }

    // 棋譜ファイルのみ読み込み許可
    if !is_kifu_file(&path) {
        return Err(format!("棋譜ファイルではありません: {}", path.display()));
    }

    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[command]
pub fn save_kifu_file(
    parent_dir: String,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let parent_path = PathBuf::from(&parent_dir);
    let file_path = parent_path.join(&file_name);

    // 親ディレクトリの存在確認
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(format!(
            "親ディレクトリが存在しません: {}",
            parent_path.display()
        ));
    }

    // 棋譜ファイルかチェック
    if !is_kifu_file(&file_path) {
        return Err(format!("棋譜ファイルの拡張子ではありません: {}", file_name));
    }

    // ファイル保存
    fs::write(&file_path, content).map_err(|e| e.to_string())?;

    // 保存したファイルのパスを返す
    Ok(file_path.to_string_lossy().to_string())
}

#[command]
pub fn create_directory(parent_dir: String, dir_name: String) -> Result<String, String> {
    let parent_path = PathBuf::from(&parent_dir);
    let new_dir_path = parent_path.join(&dir_name);

    // 親ディレクトリの存在確認
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err(format!(
            "親ディレクトリが存在しません: {}",
            parent_path.display()
        ));
    }

    // 既に存在するかチェック
    if new_dir_path.exists() {
        return Err(format!(
            "ディレクトリが既に存在します: {}",
            new_dir_path.display()
        ));
    }

    fs::create_dir(&new_dir_path).map_err(|e| e.to_string())?;

    // 作成したディレクトリのパスを返す
    Ok(new_dir_path.to_string_lossy().to_string())
}

#[command]
pub fn delete_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);

    if !path.exists() {
        return Err(format!("ファイルが存在しません: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!(
            "指定されたパスはファイルではありません: {}",
            path.display()
        ));
    }

    // 棋譜ファイルのみ削除許可
    if !is_kifu_file(&path) {
        return Err(format!("棋譜ファイルではありません: {}", path.display()));
    }

    fs::remove_file(path).map_err(|e| e.to_string())
}

#[command]
pub fn delete_directory(dir_path: String) -> Result<(), String> {
    let path = PathBuf::from(&dir_path);

    if !path.exists() {
        return Err(format!("ディレクトリが存在しません: {}", path.display()));
    }

    if !path.is_dir() {
        return Err(format!(
            "指定されたパスはディレクトリではありません: {}",
            path.display()
        ));
    }

    fs::remove_dir_all(path).map_err(|e| e.to_string())
}
