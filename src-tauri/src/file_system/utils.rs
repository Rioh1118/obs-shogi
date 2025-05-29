use std::path::Path;
use uuid::Uuid;

pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn get_file_type(path: &Path) -> String {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("kif") => "kif".to_string(),
        Some("ki2") => "ki2".to_string(),
        _ => "other".to_string(),
    }
}

pub fn get_icon_type(is_dir: bool, file_type: &str) -> String {
    if is_dir {
        "folder".to_string()
    } else {
        match file_type {
            "kif" | "ki2" => "kif-file".to_string(),
            _ => "document".to_string(),
        }
    }
}
