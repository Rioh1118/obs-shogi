use std::fs;
use std::path::PathBuf;
use tauri::command;

#[command]
pub fn create_file(file_path: String, content: Option<String>) -> Result<(), String> {
    let path = PathBuf::from(file_path);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = content.unwrap_or_default();
    fs::write(path, content).map_err(|e| e.to_string())
}

#[command]
pub fn create_directory(dir_path: String) -> Result<(), String> {
    let path = PathBuf::from(dir_path);
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[command]
pub fn delete_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);

    if !path.exists() {
        return Err(format!("ファイルが存在しません: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!(
            "指定されたパスはファイルではありません: {}",
            path.display()
        ));
    }

    fs::remove_file(path).map_err(|e| e.to_string())
}

#[command]
pub fn delete_directory(dir_path: String) -> Result<(), String> {
    let path = PathBuf::from(dir_path);

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

#[command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old = PathBuf::from(old_path);
    let new = PathBuf::from(new_path);

    if !old.exists() {
        return Err(format!("元のファイルが存在しません: {}", old.display()));
    }

    if new.exists() {
        return Err(format!("新しいパスが既に存在します: {}", new.display()));
    }
    fs::rename(old, new).map_err(|e| e.to_string())
}

#[command]
pub fn read_file(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(file_path);

    if !path.exists() {
        return Err(format!("ファイルが存在しません: {}", path.display()));
    }

    if !path.is_file() {
        return Err(format!(
            "指定されたパスはファイルではありません: {}",
            path.display()
        ));
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[command]
pub fn write_file(file_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::write(path, content).map_err(|e| e.to_string())
}
