use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
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

/// 名前として使えるかを見て、**実際に使う形（前後の空白を落としたもの）を返す**。
///
/// 検証した文字列と、そのあとパスを組む文字列は同じものでなければならない。
/// 生の名前でパスを組むと、`"a "` のように検証は通るが OS 側で別の名前になる
/// （Windows は末尾の空白と `.` を落とす）ものが素通りする。
///
/// `message` は開発者向けのログ。利用者に見せる文は code から引く
pub fn validate_basename(name: &str) -> Result<String, FsError> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err(FsError::new(FsErrorCode::InvalidNameEmpty, "name is empty"));
    }
    if trimmed == "." || trimmed == ".." {
        return Err(FsError::new(
            FsErrorCode::InvalidNameReserved,
            "name is a reserved path segment",
        ));
    }
    // パス区切りが入ってたら弾く（basenameのみ許可）
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(FsError::new(
            FsErrorCode::InvalidNameSeparator,
            "name contains a path separator",
        ));
    }
    // null byte は OS によっては別のパスに化けるので拒否
    if trimmed.contains('\0') {
        return Err(FsError::new(
            FsErrorCode::InvalidNameControl,
            "name contains a NUL byte",
        ));
    }
    Ok(trimmed.to_string())
}

/// AppConfig.root_dir を取得（未設定なら None）
fn load_root_dir<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, FsError> {
    let cfg_path = app
        .path()
        .app_config_dir()
        .map_err(|e| FsError::new(FsErrorCode::InvalidPath, e.to_string()))?
        .join("app.json");
    if !cfg_path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&cfg_path).map_err(FsError::from)?;
    #[derive(serde::Deserialize)]
    struct Cfg {
        root_dir: Option<String>,
    }
    let cfg: Cfg = serde_json::from_str(&data)
        .map_err(|e| FsError::new(FsErrorCode::InvalidPath, e.to_string()))?;
    Ok(cfg.root_dir.map(PathBuf::from))
}

/// 与えられた target が AppConfig.root_dir 配下にあるか検証する。
/// target が存在しない場合は、親ディレクトリを canonicalize して合成する。
/// root_dir が未設定なら検証をスキップする（後方互換）。
pub fn validate_under_root<R: Runtime>(app: &AppHandle<R>, target: &Path) -> Result<(), FsError> {
    let Some(root) = load_root_dir(app)? else {
        return Ok(());
    };
    let canonical_root = fs::canonicalize(&root).map_err(|e| {
        FsError::new(
            FsErrorCode::InvalidPath,
            format!("root_dir canonicalize: {e}"),
        )
    })?;

    let canonical_target = if target.exists() {
        fs::canonicalize(target).map_err(FsError::from)?
    } else {
        let parent = target
            .parent()
            .ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "no parent"))?;
        let name = target
            .file_name()
            .ok_or_else(|| FsError::new(FsErrorCode::InvalidPath, "no filename"))?;
        let parent_canon = fs::canonicalize(parent).map_err(FsError::from)?;
        parent_canon.join(name)
    };

    if !canonical_target.starts_with(&canonical_root) {
        return Err(
            FsError::new(FsErrorCode::InvalidPath, "path is outside project root")
                .with_path(target.to_string_lossy().to_string()),
        );
    }
    Ok(())
}

/// テンポラリファイル経由の atomic write
/// 既存ファイルの上書きが途中で壊れないように、tmp に書いてから rename する
pub fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let tmp = match path.extension() {
        Some(ext) => {
            let mut new_ext = ext.to_os_string();
            new_ext.push(".tmp");
            path.with_extension(new_ext)
        }
        None => path.with_extension("tmp"),
    };
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        f.write_all(data)?;
        f.flush()?;
    }
    match fs::rename(&tmp, path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

// TODO(#215): dest が src と同じ実体かを見ていない。APFS では大文字小文字だけを
// 変える改名が、自分自身を衝突相手として弾かれる
pub fn ensure_not_exists(path: &Path) -> Result<(), FsError> {
    if path.exists() {
        return Err(
            FsError::new(FsErrorCode::AlreadyExists, "destination already exists")
                .with_existing_path(path.to_string_lossy().to_string()),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_the_name_that_will_be_used() {
        // 前後の空白を落とした形を返す。呼び出し元はこれでパスを組む。
        // 生の名前で組むと、Windows が末尾の空白と `.` を落とすため、
        // 検証した文字列と実際にできるファイルが別のものになる
        assert_eq!(validate_basename("  研究.kif  ").unwrap(), "研究.kif");
    }

    #[test]
    fn rejects_names_that_are_not_a_single_segment() {
        for name in ["", "   ", ".", "..", "a/b", "a\\b", "a\0b"] {
            assert!(
                validate_basename(name).is_err(),
                "{name:?} を通してはいけない"
            );
        }
    }

    #[test]
    fn reports_why_it_was_rejected() {
        use crate::file_system::error::FsErrorCode;

        let code = |name: &str| format!("{:?}", validate_basename(name).unwrap_err().code);
        assert_eq!(code(""), format!("{:?}", FsErrorCode::InvalidNameEmpty));
        assert_eq!(
            code(".."),
            format!("{:?}", FsErrorCode::InvalidNameReserved)
        );
        assert_eq!(
            code("a/b"),
            format!("{:?}", FsErrorCode::InvalidNameSeparator)
        );
        assert_eq!(
            code("a\0b"),
            format!("{:?}", FsErrorCode::InvalidNameControl)
        );
    }
}
