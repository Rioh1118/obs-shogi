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

#[cfg(test)]
mod tests {
    use super::*;
    use test_support::dir::temp_dir;

    /// フォルダだけを通す。ファイルを通すと、その下の `engines` や AI フォルダを作りに行って OS の失敗になる
    #[test]
    fn only_an_existing_directory_passes() {
        let dir = temp_dir("ai-dir-validate");
        let file = dir.join("file");
        fs::write(&file, "").expect("書けない");

        assert!(validate_dir("ai_root", &dir.to_string_lossy()).is_ok());
        assert!(validate_dir("ai_root", &file.to_string_lossy()).is_err());
        assert!(validate_dir("ai_root", &dir.join("missing").to_string_lossy()).is_err());
        assert!(validate_dir("ai_root", "  ").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 種類は読んだまま返す。無いものは `Unknown`
    #[test]
    fn the_kind_is_read_from_the_entry_itself() {
        let dir = temp_dir("ai-dir-kind");
        fs::write(dir.join("file"), "").expect("書けない");
        fs::create_dir(dir.join("sub")).expect("作れない");

        assert!(matches!(kind_of(&dir.join("file")), FsKind::File));
        assert!(matches!(kind_of(&dir.join("sub")), FsKind::Dir));
        assert!(matches!(kind_of(&dir.join("missing")), FsKind::Unknown));
        let _ = fs::remove_dir_all(&dir);
    }

    /// symlink は辿らない。フォルダを指していても `Symlink` と返す
    #[cfg(unix)]
    #[test]
    fn a_symlink_is_not_followed() {
        let dir = temp_dir("ai-dir-kind-link");
        fs::create_dir(dir.join("sub")).expect("作れない");
        std::os::unix::fs::symlink(dir.join("sub"), dir.join("link")).expect("リンクを作れない");

        assert!(matches!(kind_of(&dir.join("link")), FsKind::Symlink));
        let _ = fs::remove_dir_all(&dir);
    }
}
