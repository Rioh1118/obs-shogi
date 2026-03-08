use std::path::Path;
use uuid::Uuid;

use crate::file_system::error::{FsError, FsErrorCode};

pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn get_file_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
}

pub fn is_kifu_file(path: &Path) -> bool {
    matches!(
        get_file_extension(path).as_deref(),
        Some("kif") | Some("ki2") | Some("jkf") | Some("csa")
    )
}

pub fn validate_basename(name: &str) -> Result<(), FsError> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(FsError::new(
            super::error::FsErrorCode::InvalidName,
            "名前が空です",
        ));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(FsError::new(FsErrorCode::InvalidName, "無効な名前です"));
    }
    // パス区切りが入ってたら弾く（basenameのみ許可）
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(FsError::new(
            FsErrorCode::InvalidName,
            "名前にパス区切りを含めることはできません",
        ));
    }
    Ok(())
}

pub fn ensure_not_exists(path: &Path) -> Result<(), FsError> {
    if path.exists() {
        return Err(
            FsError::new(FsErrorCode::AlreadyExists, "同名の項目が既に存在します")
                .with_existing_path(path.to_string_lossy().to_string()),
        );
    }
    Ok(())
}
