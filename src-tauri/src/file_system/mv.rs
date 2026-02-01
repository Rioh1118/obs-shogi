use std::fs;
use std::path::PathBuf;
use tauri::command;

use super::utils::is_kifu_file;

fn validate_basename(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("名前が空です".to_string());
    }
    if name == "." || name == ".." {
        return Err("無効な名前です".to_string());
    }
    // パス区切りが入ってたら弾く（basenameのみ許可）
    if name.contains('/') || name.contains('\\') {
        return Err("名前にパス区切りが含まれています".to_string());
    }
    Ok(())
}

#[command]
pub fn rename_kifu_file(file_path: String, new_file_name: String) -> Result<String, String> {
    let src = PathBuf::from(&file_path);

    if !src.exists() {
        return Err(format!("ファイルが存在しません: {}", src.display()));
    }
    if !src.is_file() {
        return Err(format!(
            "指定されたパスはファイルではありません: {}",
            src.display()
        ));
    }
    if !is_kifu_file(&src) {
        return Err(format!("棋譜ファイルではありません: {}", src.display()));
    }

    validate_basename(&new_file_name)?;

    let parent = src
        .parent()
        .ok_or_else(|| format!("親ディレクトリが取得できません: {}", src.display()))?;
    let dest = parent.join(&new_file_name);

    // リネーム後も棋譜拡張子のみ許可（拡張子変更を防ぐ）
    if !is_kifu_file(&dest) {
        return Err(format!(
            "棋譜ファイルの拡張子ではありません: {}",
            new_file_name
        ));
    }

    if dest.exists() {
        return Err(format!(
            "同名のファイルが既に存在します: {}",
            dest.display()
        ));
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn mv_kifu_file(
    file_path: String,
    dest_dir: String,
    new_file_name: Option<String>,
) -> Result<String, String> {
    let src = PathBuf::from(&file_path);

    if !src.exists() {
        return Err(format!("ファイルが存在しません: {}", src.display()));
    }
    if !src.is_file() {
        return Err(format!(
            "指定されたパスはファイルではありません: {}",
            src.display()
        ));
    }
    if !is_kifu_file(&src) {
        return Err(format!("棋譜ファイルではありません: {}", src.display()));
    }

    let dest_dir = PathBuf::from(&dest_dir);
    if !dest_dir.exists() || !dest_dir.is_dir() {
        return Err(format!(
            "移動先ディレクトリが存在しません: {}",
            dest_dir.display()
        ));
    }

    let name = match new_file_name {
        Some(n) => {
            validate_basename(&n)?;
            n
        }
        None => src
            .file_name()
            .ok_or_else(|| "ファイル名が取得できません".to_string())?
            .to_string_lossy()
            .to_string(),
    };

    let dest = dest_dir.join(&name);

    // 移動後も棋譜拡張子のみ許可
    if !is_kifu_file(&dest) {
        return Err(format!("棋譜ファイルの拡張子ではありません: {}", name));
    }

    if dest.exists() {
        return Err(format!("移動先に既に存在します: {}", dest.display()));
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn rename_directory(dir_path: String, new_dir_name: String) -> Result<String, String> {
    let src = PathBuf::from(&dir_path);

    if !src.exists() {
        return Err(format!("ディレクトリが存在しません: {}", src.display()));
    }
    if !src.is_dir() {
        return Err(format!(
            "指定されたパスはディレクトリではありません: {}",
            src.display()
        ));
    }

    validate_basename(&new_dir_name)?;

    let parent = src
        .parent()
        .ok_or_else(|| format!("親ディレクトリが取得できません: {}", src.display()))?;
    let dest = parent.join(&new_dir_name);

    if dest.exists() {
        return Err(format!(
            "同名のディレクトリが既に存在します: {}",
            dest.display()
        ));
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[command]
pub fn mv_directory(
    dir_path: String,
    dest_parent_dir: String,
    new_dir_name: Option<String>,
) -> Result<String, String> {
    let src = PathBuf::from(&dir_path);

    if !src.exists() {
        return Err(format!("ディレクトリが存在しません: {}", src.display()));
    }
    if !src.is_dir() {
        return Err(format!(
            "指定されたパスはディレクトリではありません: {}",
            src.display()
        ));
    }

    let dest_parent = PathBuf::from(&dest_parent_dir);
    if !dest_parent.exists() || !dest_parent.is_dir() {
        return Err(format!(
            "移動先ディレクトリが存在しません: {}",
            dest_parent.display()
        ));
    }

    let name = match new_dir_name {
        Some(n) => {
            validate_basename(&n)?;
            n
        }
        None => src
            .file_name()
            .ok_or_else(|| "ディレクトリ名が取得できません".to_string())?
            .to_string_lossy()
            .to_string(),
    };

    let dest = dest_parent.join(&name);

    if dest.exists() {
        return Err(format!("移動先に既に存在します: {}", dest.display()));
    }

    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}
