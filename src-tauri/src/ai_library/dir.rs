//! AI ルートの下にあるものが何で、そこがディレクトリとして扱えるか。

use serde::Serialize;
use std::{fs, path::Path};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsKind {
    File,
    Dir,
    Symlink,
    Unknown,
}

pub fn validate_dir(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    let p = Path::new(value);
    if !p.exists() {
        return Err(format!("{label} does not exist: {value}"));
    }
    if !p.is_dir() {
        return Err(format!("{label} is not a directory: {value}"));
    }
    Ok(())
}

pub fn kind_of(path: &Path) -> FsKind {
    match fs::symlink_metadata(path) {
        Ok(md) => {
            let ft = md.file_type();
            if ft.is_symlink() {
                FsKind::Symlink
            } else if ft.is_dir() {
                FsKind::Dir
            } else if ft.is_file() {
                FsKind::File
            } else {
                FsKind::Unknown
            }
        }
        Err(_) => FsKind::Unknown,
    }
}
