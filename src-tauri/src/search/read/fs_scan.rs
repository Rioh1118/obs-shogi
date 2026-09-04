use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Error)]
pub enum ScanError {
    #[error("root directory does not exist: {0}")]
    RootNotFound(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// 対象棋譜ファイルの種別
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum KifuKind {
    Kif,
    Ki2,
    Csa,
    Jkf,
}

impl KifuKind {
    #[inline]
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
        match ext.as_str() {
            "kif" => Some(Self::Kif),
            "ki2" => Some(Self::Ki2),
            "csa" => Some(Self::Csa),
            "jkf" => Some(Self::Jkf),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRecord {
    pub path: PathBuf,
    pub kind: KifuKind,
    pub size: u64,
    pub mtime_ms: u128,
}

/// 走査スナップショット
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanSnapshot {
    pub by_path: HashMap<String, FileRecord>,
    pub root_dir: PathBuf,
}

/// 差分結果
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanDiff {
    pub added: Vec<FileRecord>,
    pub modified: Vec<FileRecord>,
    pub removed: Vec<String>,
}

/// ignore は「高速化のためのオプション」
#[derive(Debug, Clone)]
pub struct ScanOptions {
    pub ignore_dir_names: HashSet<String>,
    pub follow_links: bool,
}

impl Default for ScanOptions {
    fn default() -> Self {
        let mut ignore = HashSet::new();
        ignore.insert(".git".to_string());
        ignore.insert("node_modules".to_string());
        ignore.insert("target".to_string());
        Self {
            ignore_dir_names: ignore,
            follow_links: false,
        }
    }
}

/// ルート配下を再帰走査し、対象拡張子だけ列挙
/// - 対象外ファイルはメタ情報すら取得しない（最速優先）
pub fn scan_kifu_files(root_dir: &Path, opts: &ScanOptions) -> Result<Vec<FileRecord>, ScanError> {
    if !root_dir.exists() {
        return Err(ScanError::RootNotFound(root_dir.display().to_string()));
    }

    let walker = WalkDir::new(root_dir)
        .follow_links(opts.follow_links)
        .into_iter()
        .filter_entry(|e| !should_skip_dir(e, opts));

    let mut out = Vec::new();

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();

        // ★対象拡張子以外は即スキップ（メタ取得なし）
        let Some(kind) = KifuKind::from_path(path) else {
            continue;
        };

        // メタ取得
        let meta = match fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let size = meta.len();
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| system_time_to_unix_ms(t).ok())
            .unwrap_or(0);

        // canonicalizeは可能なら（失敗しても動くの優先）
        let abs = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

        out.push(FileRecord {
            path: abs,
            kind,
            size,
            mtime_ms,
        });
    }

    Ok(out)
}

#[inline]
fn should_skip_dir(entry: &DirEntry, opts: &ScanOptions) -> bool {
    if !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    opts.ignore_dir_names.contains(name.as_ref())
}

#[inline]
fn system_time_to_unix_ms(t: SystemTime) -> Result<u128, std::time::SystemTimeError> {
    Ok(t.duration_since(SystemTime::UNIX_EPOCH)?.as_millis())
}

pub fn snapshot_from_records(root_dir: &Path, records: Vec<FileRecord>) -> ScanSnapshot {
    let mut map = HashMap::with_capacity(records.len());
    for r in records {
        map.insert(path_key(&r.path), r);
    }
    ScanSnapshot {
        root_dir: root_dir.to_path_buf(),
        by_path: map,
    }
}

pub fn diff_snapshot(prev: &ScanSnapshot, next: &ScanSnapshot) -> ScanDiff {
    let mut diff = ScanDiff::default();

    for (k, r_next) in &next.by_path {
        match prev.by_path.get(k) {
            None => diff.added.push(r_next.clone()),
            Some(r_prev) => {
                if r_prev.size != r_next.size || r_prev.mtime_ms != r_next.mtime_ms {
                    diff.modified.push(r_next.clone());
                }
            }
        }
    }

    for k in prev.by_path.keys() {
        if !next.by_path.contains_key(k) {
            diff.removed.push(k.clone());
        }
    }

    diff
}

#[inline]
pub fn path_key(p: &Path) -> String {
    p.to_string_lossy().to_string()
}
