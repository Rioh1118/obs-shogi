//! AI ルートの中身を1回で数え上げる。

use serde::Serialize;
use std::path::Path;

use super::dir::{kind_of, FsKind};
use super::engines::{EngineCandidate, ENGINES_DIR};
use super::profile::ProfileCandidate;
use super::{engines, profile};

/// AI ルートを1回読んだ結果。欄の綴りは TS の `AiRootIndex` が読む
#[derive(Debug, Clone, Serialize)]
pub struct AiRootIndex {
    pub ai_root: String,

    pub engines_dir: DirInfo,
    pub engines: Vec<EngineCandidate>,

    pub profiles: Vec<ProfileCandidate>,
}

/// engines/ が何として在るか
///
/// `exists` は symlink を辿り、`kind` は辿らない。フォルダを指すリンクは
/// `exists: true` と `kind: Symlink` の組になる。切れたリンクは `exists: false` と `kind: Unknown`
#[derive(Debug, Clone, Serialize)]
pub struct DirInfo {
    pub path: String,
    pub exists: bool,
    pub kind: FsKind,
}

/// engines/ と AI フォルダを読む。
///
/// `Err` になるのは AI ルートか engines/ を開けないときと、AI ルートの中の1件を読めないとき。
/// engines/ が無いのは失敗ではない
pub fn index(ai_root: String) -> Result<AiRootIndex, String> {
    let root = Path::new(&ai_root);

    let engines_dir_path = root.join(ENGINES_DIR);
    let engines_dir_exists = engines_dir_path.exists();
    let engines_dir_kind = if engines_dir_exists {
        kind_of(&engines_dir_path)
    } else {
        FsKind::Unknown
    };

    let found = if engines_dir_exists && engines_dir_path.is_dir() {
        engines::read_all(&engines_dir_path)?
    } else {
        vec![]
    };

    let profiles = profile::read_all(root)?;

    Ok(AiRootIndex {
        ai_root,
        engines_dir: DirInfo {
            path: engines_dir_path.to_string_lossy().to_string(),
            exists: engines_dir_exists,
            kind: engines_dir_kind,
        },
        engines: found,
        profiles,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::ai_library::engines::tests::{write, NATIVE};
    use std::fs;
    use test_support::dir::temp_dir;

    /// engines/ が在れば中を読み、AI フォルダも同じ1回で返す
    #[test]
    fn engines_and_profiles_are_read_together() {
        let root = temp_dir("ai-scan-both");
        write(&root.join(ENGINES_DIR).join("engine"), &NATIVE, 0o755);
        fs::create_dir_all(root.join("suisho/eval")).expect("作れない");

        let found = index(root.to_string_lossy().to_string()).expect("読める");

        assert!(found.engines_dir.exists);
        assert!(matches!(found.engines_dir.kind, FsKind::Dir));
        let engines: Vec<_> = found.engines.iter().map(|c| c.entry.as_str()).collect();
        assert_eq!(engines, ["engine"]);
        let profiles: Vec<_> = found.profiles.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(profiles, ["suisho"]);
        let _ = fs::remove_dir_all(&root);
    }

    /// engines/ が無ければ、無いと返して列挙を止めない
    #[test]
    fn a_missing_engines_folder_is_reported_as_missing() {
        let root = temp_dir("ai-scan-missing");

        let found = index(root.to_string_lossy().to_string()).expect("読める");

        assert!(!found.engines_dir.exists);
        assert!(matches!(found.engines_dir.kind, FsKind::Unknown));
        assert!(found.engines.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    /// 切れたリンクの engines/ は「無い」と返す。TS の `classifyEnginesDir` はこれを `missing` に分ける
    #[test]
    fn a_broken_link_as_the_engines_folder_is_reported_as_missing() {
        let root = temp_dir("ai-scan-broken");
        std::os::unix::fs::symlink(root.join("gone"), root.join(ENGINES_DIR))
            .expect("リンクを作れない");

        let found = index(root.to_string_lossy().to_string()).expect("読める");

        assert!(!found.engines_dir.exists);
        assert!(matches!(found.engines_dir.kind, FsKind::Unknown));
        let _ = fs::remove_dir_all(&root);
    }
}
