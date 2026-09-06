//! ディスクを歩いて「どの棋譜ファイルがあるか」を数える。
//!
//! **中身は読まない。** 読むのは `read/kifu_reader.rs`。ここが返すのは
//! パスと種別と `(size, mtime_ms)` だけ。
//!
//! **`(size, mtime_ms)` が変更の唯一の判定材料**（[`diff_snapshot`]）。
//! 触っていないファイルは読み直さないので、**棋譜の解釈が変わっても
//! 古い解釈のまま索引に残る** —— そのときはキャッシュの版を上げて
//! 全件を作り直す（`cache/format.rs` の `CACHE_VERSION`）。

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use walkdir::{DirEntry, WalkDir};

/// 走査そのものが立ち行かなかった理由。
///
/// **1ファイルが読めないのはここではない** —— それは
/// `read/kifu_reader.rs` の話で、走査は続く。
#[derive(Debug, Error)]
pub enum ScanError {
    #[error("root directory does not exist: {0}")]
    RootNotFound(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// 対象棋譜ファイルの種別。**拡張子だけで決める。**
///
/// 中身を見ないので、`.kif` に改名した別のファイルもここを通る。
/// 読めるかどうかは `read/kifu_reader.rs` が決める。
///
/// **blob に1バイトで書く**ので、増やすと `CACHE_VERSION` を上げる話になる
/// （`cache/wire.rs` の `kind_to_u8`）。
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

/// 走査で見つけた1ファイル。**中身は読んでいない。**
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRecord {
    pub path: PathBuf,
    pub kind: KifuKind,
    /// バイト数。**変更の判定に使う**
    pub size: u64,
    /// 最終更新。**変更の判定に使う**
    ///
    /// `u128` なのは [`SystemTime::duration_since`] の `as_millis` がそう返すため。
    /// blob には `u64` に落として書く（`cache/format.rs`）——
    /// ミリ秒で `u64` は5億年以上持つので、狭めても足りる。
    pub mtime_ms: u128,
}

/// ある瞬間の走査の結果。
///
/// **索引とは別に持ち回る。** 索引が差し替わっても、どのファイルを
/// どの `(size, mtime_ms)` で見ていたかは引き継ぐ必要がある
/// （引き継がないと全ファイルが「変わった」に見える）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScanSnapshot {
    /// 鍵は [`path_key`] を通した文字列。**`PathBuf` を鍵にしない**
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
/// 最終更新をミリ秒に。**UNIX epoch より前の時刻は `Err`。**
fn system_time_to_unix_ms(t: SystemTime) -> Result<u128, std::time::SystemTimeError> {
    Ok(t.duration_since(SystemTime::UNIX_EPOCH)?.as_millis())
}

/// 走査の結果を [`ScanSnapshot`] にまとめる。
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

/// 2つの走査の差。
///
/// **変わったかどうかは `(size, mtime_ms)` だけで決める。** 中身は読まない。
///
/// つまり**同じ大きさ・同じ時刻で中身だけ差し替わったファイルは見逃す。**
/// 触っていないファイルを読み直さないためにそうしていて、
/// 棋譜の解釈が変わったときは版を上げて全件を作り直す
/// （`cache/format.rs` の `CACHE_VERSION`）。
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

/// パスを [`ScanSnapshot::by_path`] の鍵にする。
///
/// **`PathBuf` を鍵にしない。** この鍵はそのまま blob に書いて読み戻すので
/// （`cache/format.rs`）、`PathBuf` のままだと OS ごとの綴りの違いが
/// キャッシュの互換性の話になる。
///
/// **正規化しない。** 大文字小文字も `..` も畳まないので、
/// 同じファイルを別の綴りで指すと別の項目になる。走査は1つの根の下を
/// `WalkDir` で歩くだけなので、いまはその形が出ない。
#[inline]
pub fn path_key(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(path: &str, size: u64, mtime_ms: u128) -> FileRecord {
        FileRecord {
            path: PathBuf::from(path),
            kind: KifuKind::Kif,
            size,
            mtime_ms,
        }
    }

    fn snap(records: Vec<FileRecord>) -> ScanSnapshot {
        snapshot_from_records(Path::new("/tmp/root"), records)
    }

    /// **大きさが変われば「変わった」。**
    #[test]
    fn a_changed_size_counts_as_modified() {
        let d = diff_snapshot(
            &snap(vec![rec("/tmp/root/a.kif", 10, 1)]),
            &snap(vec![rec("/tmp/root/a.kif", 11, 1)]),
        );
        assert_eq!(d.modified.len(), 1, "大きさの変化を見ていない");
        assert!(d.added.is_empty() && d.removed.is_empty());
    }

    /// **時刻が変われば「変わった」。**
    #[test]
    fn a_changed_mtime_counts_as_modified() {
        let d = diff_snapshot(
            &snap(vec![rec("/tmp/root/a.kif", 10, 1)]),
            &snap(vec![rec("/tmp/root/a.kif", 10, 2)]),
        );
        assert_eq!(d.modified.len(), 1, "時刻の変化を見ていない");
    }

    /// **大きさも時刻も同じなら、中身が違っても見逃す。**
    ///
    /// これは仕様。触っていないファイルを読み直さないためにそうしていて、
    /// 棋譜の解釈が変わったときは版を上げて全件を作り直す。
    /// **見逃さない形に変えるなら、`CACHE_VERSION` の doc も直すこと。**
    #[test]
    fn the_same_size_and_mtime_is_treated_as_unchanged() {
        let d = diff_snapshot(
            &snap(vec![rec("/tmp/root/a.kif", 10, 1)]),
            &snap(vec![rec("/tmp/root/a.kif", 10, 1)]),
        );
        assert!(
            d.modified.is_empty(),
            "中身を見ていないはずなのに変化を報告している"
        );
    }

    /// **増えた・消えたを取り違えない。**
    #[test]
    fn added_and_removed_are_not_confused() {
        let d = diff_snapshot(
            &snap(vec![rec("/tmp/root/gone.kif", 1, 1)]),
            &snap(vec![rec("/tmp/root/new.kif", 1, 1)]),
        );

        assert_eq!(d.added.len(), 1, "増えた側が違う");
        assert_eq!(d.added[0].path, PathBuf::from("/tmp/root/new.kif"));
        assert_eq!(d.removed, vec!["/tmp/root/gone.kif".to_owned()]);
        assert!(d.modified.is_empty());
    }

    /// **種別は拡張子だけで決まる。中身は見ない。**
    #[test]
    fn the_kind_comes_from_the_extension_alone() {
        assert_eq!(
            KifuKind::from_path(Path::new("/tmp/a.KIF")),
            Some(KifuKind::Kif),
            "大文字の拡張子を落としている"
        );
        assert_eq!(
            KifuKind::from_path(Path::new("/tmp/a.csa")),
            Some(KifuKind::Csa)
        );
        assert_eq!(KifuKind::from_path(Path::new("/tmp/a.txt")), None);
        assert_eq!(KifuKind::from_path(Path::new("/tmp/noext")), None);
    }
}
