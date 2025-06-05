use std::path::Path;
use uuid::Uuid;

pub fn generate_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn get_file_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
}

pub fn is_kifu_file(path: &Path) -> bool {
    match get_file_extension(path).as_deref() {
        Some("kif") | Some("ki2") | Some("jkf") | Some("csa") | Some("psn") => true,
        _ => false,
    }
}

pub fn is_hidden_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}
