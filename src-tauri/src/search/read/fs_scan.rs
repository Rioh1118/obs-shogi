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

    /// **root そのものを読めなかった。** 在るのに開けない
    /// （権限、未マウントの共有、TCC の許可が落ちた）。
    ///
    /// `RootNotFound` と分ける——`exists()` は権限が無くても真を返すので、
    /// 「無い」と「読めない」は別の症状で、利用者への案内も違う。
    #[error("root directory is not readable: {0}")]
    RootUnreadable(String),

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

/// 走査の結果。**完全だったかどうかを一緒に返す。**
///
/// `files` だけを返すと、**読めなかったせいで見つからなかった**ものと
/// **本当に消えた**ものが同じ値になる。呼び手はそれを差分に掛けるので、
/// 読めなかった部分木の棋譜が丸ごと `removed` に並び、
/// **索引から黙って消える**（画面は「準備完了」と減った件数を出すだけ）。
#[derive(Debug)]
pub struct Scanned {
    /// 見つかった棋譜
    pub files: Vec<FileRecord>,
    /// **読めなかった場所。** ディレクトリとは限らない——`metadata` に失敗した
    /// ファイル自身も入る（`0444` のディレクトリの中身がそう）。
    ///
    /// **空でも「全部読めた」ではない**——場所の分からない失敗は
    /// `unknown_gaps` に載る。完全だったかは [`Scanned::is_partial`] で見る。
    pub unreadable: Vec<String>,
    /// **どこが読めなかったか分からない失敗があった。**
    ///
    /// `read_dir` の反復中の失敗はパスを持たない（`walkdir` が `path: None` を作る）。
    /// 場所が分からないので引き継ぐ範囲を決められない
    /// ——呼び手は**その回の削除を1件も当てない**こと。
    pub unknown_gaps: bool,
}

impl Scanned {
    /// 読めなかったものがあったか。**場所が分かるものと分からないものの両方。**
    ///
    /// 呼び手が `!unreadable.is_empty()` と書くと、`unknown_gaps` を落とした側だけが
    /// 黙る——同じ失敗が経路によって違う結末になる。
    pub fn is_partial(&self) -> bool {
        !self.unreadable.is_empty() || self.unknown_gaps
    }
}

/// ルート配下を再帰走査し、対象拡張子だけ列挙
/// - 対象外ファイルはメタ情報すら取得しない（最速優先）
///
/// **読めなかったものを捨てない。** 捨てると呼び手が「消えた」と読む
/// （[`Scanned`] の doc）。
pub fn scan_kifu_files(root_dir: &Path, opts: &ScanOptions) -> Result<Scanned, ScanError> {
    if !root_dir.exists() {
        return Err(ScanError::RootNotFound(root_dir.display().to_string()));
    }

    // **綴りを入口で1度だけ揃える。** ファイルごとに `canonicalize` して
    // `unreadable` は素のパスを積む形にすると、root に symlink が1つ挟まるだけで
    // （macOS の `/tmp` → `/private/tmp`）**両者が一度も一致しなくなる**
    // ——引き継ぎが丸ごと空振りし、読めない場所の棋譜が削除として消える。
    //
    // 揃えられなければ返す。素のパスへ落とすと、揃っているという前提だけが
    // 消えて走査は続く。root を辿れないなら `WalkDir` も depth 0 で落ちるので、
    // ここで返しても届く結末は変わらない
    let root_dir = &root_dir
        .canonicalize()
        .map_err(|_| ScanError::RootUnreadable(root_dir.display().to_string()))?;

    let walker = WalkDir::new(root_dir)
        .follow_links(opts.follow_links)
        .into_iter()
        .filter_entry(|e| !should_skip_dir(e, opts));

    let mut out = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();
    let mut unknown_gaps = false;

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                // **root 自身が読めないなら、走査そのものが失敗。**
                // 0件と区別が付かない値を返さない
                if e.depth() == 0 {
                    return Err(ScanError::RootUnreadable(root_dir.display().to_string()));
                }
                // **パスを持つ失敗と持たない失敗を分ける。** 前者はその部分木が
                // 丸ごと落ちる、いちばん damage の大きい種類。後者は範囲を
                // 決められないので、呼び手に「削除を当てない」を選ばせる
                match e.path() {
                    Some(path) => unreadable.push(path.display().to_string()),
                    None => unknown_gaps = true,
                }
                continue;
            }
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();

        // ★対象拡張子以外は即スキップ（メタ取得なし）
        let Some(kind) = KifuKind::from_path(path) else {
            continue;
        };

        // メタ取得。**失敗を捨てない**——捨てると、そのファイルは `files` にも
        // `unreadable` にも入らず、差分では削除と同じ形になる。`0444` の
        // ディレクトリ（読めるが辿れない）はこの腕だけを通る
        let meta = match fs::metadata(path) {
            Ok(m) => m,
            Err(_) => {
                unreadable.push(path.display().to_string());
                continue;
            }
        };

        let size = meta.len();
        let mtime_ms = meta
            .modified()
            .ok()
            .and_then(|t| system_time_to_unix_ms(t).ok())
            .unwrap_or(0);

        // **ここで `canonicalize` しない。** root は揃えてあるので、`WalkDir` が
        // 返す綴りはその下で既に一貫している。ここで解くと、`follow_links` で
        // 辿った先が root の外にある場合に**そのファイルだけ綴りが外へ出る**
        // ——`unreadable` の前置きにも前回の走査にも二度と一致しない。
        // 1ファイル1 syscall も要らない
        out.push(FileRecord {
            path: path.to_path_buf(),
            kind,
            size,
            mtime_ms,
        });
    }

    Ok(Scanned {
        files: out,
        unreadable,
        unknown_gaps,
    })
}

/// 読めなかった場所の下にあったものを、**前回の走査から引き継ぐ**。
///
/// 読めないディレクトリの中身は「無くなった」と見分けが付かないので、
/// 削除として当ててはいけない。だが**捨てるだけでは足りない**——読めた分だけの
/// 走査をそのまま次回の基準にすると、そのファイルは前回からも消えるので、
/// **どの完全な走査でも二度と差分に現れない**。索引には残ったままになり、
/// 検索は存在しないファイルを返し続ける。権限が戻ったときは追加として
/// 新しい `file_id` が振られ、同じ棋譜が2件並ぶ。
///
/// **抑止は読めなかった場所と、その下だけ。** 読めたフォルダで消したファイルの
/// 削除まで止めると、ワークスペース全体で削除が反映されなくなる。
///
/// **成分単位で見て、同一も含める。** 文字列の前置きで見ると `/w/bc` を
/// `/w/b` の下と読み、同一を外すと `metadata` に失敗したファイル自身が漏れる。
/// `Path::ancestors` はどちらも満たす。
///
/// **引き継げた「場所」を返す**（引き継いだ鍵の数ではない）。
///
/// 鍵の数を返すと、呼び手は「この回のどこかで引き継ぎが起きた」しか言えない。
/// 場所ごとに失われるものが逆になる——引き継げた場所の棋譜は検索に出続け、
/// 引き継げなかった場所の棋譜は索引に無い。数で畳むと、**出ないものを
/// 「残る」と告げる**か、その逆をやる。
pub fn carry_over_unreadable(
    prev: &ScanSnapshot,
    next: &mut ScanSnapshot,
    unreadable: &[String],
) -> HashSet<String> {
    if unreadable.is_empty() {
        return HashSet::new();
    }
    // **集合で引く。** 総当たりだと `prev × unreadable` で、どちらもファイル数と
    // 同じ桁になりうる（`metadata` の失敗は1ファイルにつき1件積む）
    let blocked: HashSet<&str> = unreadable.iter().map(|u| u.trim_end_matches('/')).collect();

    let mut carried_places = HashSet::new();
    let mut carried_keys = Vec::new();
    for (key, rec) in &prev.by_path {
        if next.by_path.contains_key(key) {
            continue;
        }
        // **どの場所の下だったかを覚える。** 呼び手はこれで文言を選ぶ
        let Some(place) = Path::new(key)
            .ancestors()
            .find(|a| blocked.contains(a.to_string_lossy().as_ref()))
        else {
            continue;
        };
        carried_places.insert(place.to_string_lossy().into_owned());
        carried_keys.push((key.clone(), rec.clone()));
    }
    for (key, rec) in carried_keys {
        next.by_path.insert(key, rec);
    }
    carried_places
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

    /// **読めない場所の下の棋譜が、削除に化けないこと。**
    ///
    /// 手で組んだ `ScanSnapshot` を渡すテストは、`unreadable` と `by_path` の
    /// **綴りを揃えて作ってしまう**ので、本番で両者がずれていても緑になる。
    /// 走査から差分までを実ファイルで1本通す。
    #[cfg(unix)]
    #[test]
    fn a_file_under_an_unreadable_place_is_not_reported_as_removed() {
        use std::os::unix::fs::PermissionsExt;

        let dir = test_support::dir::temp_dir("scan-carry");
        std::fs::create_dir_all(dir.join("closed")).expect("試験用のディレクトリ");
        std::fs::create_dir_all(dir.join("open")).expect("試験用のディレクトリ");
        std::fs::write(dir.join("closed/a.kif"), b"x").expect("下ごしらえ");
        std::fs::write(dir.join("open/b.kif"), b"x").expect("下ごしらえ");
        std::fs::write(dir.join("open/gone.kif"), b"x").expect("下ごしらえ");

        let before = scan_kifu_files(&dir, &ScanOptions::default()).expect("1回目");
        assert!(before.unreadable.is_empty(), "まだ読める");
        let prev = snapshot_from_records(&dir, before.files);
        assert_eq!(prev.by_path.len(), 3);

        // 読める場所の1件を消し、もう1つの場所を辿れなくする
        std::fs::remove_file(dir.join("open/gone.kif")).expect("削除");
        std::fs::set_permissions(dir.join("closed"), std::fs::Permissions::from_mode(0o000))
            .expect("権限を落とす");

        let after = scan_kifu_files(&dir, &ScanOptions::default()).expect("2回目");
        let mut next = snapshot_from_records(&dir, after.files);
        let carried = carry_over_unreadable(&prev, &mut next, &after.unreadable);
        let diff = diff_snapshot(&prev, &next);

        let _ =
            std::fs::set_permissions(dir.join("closed"), std::fs::Permissions::from_mode(0o755));
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(
            carried.len(),
            1,
            "読めない場所の下を引き継げていない（綴りが揃っていない）。unreadable={:?}",
            after.unreadable
        );
        assert_eq!(
            diff.removed.len(),
            1,
            "読める場所の削除だけが当たるべき。removed={:?}",
            diff.removed
        );
        assert!(
            diff.removed[0].contains("gone.kif"),
            "当たった削除が違う: {:?}",
            diff.removed
        );
    }

    /// **辿れないディレクトリ（`0444`）の中身も数える。**
    ///
    /// `0444` は「読める（listing は取れる）が辿れない」ので、`walkdir` は
    /// エントリを返し、`metadata` だけが落ちる。この腕を捨てると、そのファイルは
    /// `files` にも `unreadable` にも入らず、差分では削除と同じ形になる。
    #[cfg(unix)]
    #[test]
    fn a_file_that_cannot_be_stat_ed_is_counted_as_unreadable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = test_support::dir::temp_dir("scan-stat");
        std::fs::create_dir_all(dir.join("sub")).expect("試験用のディレクトリ");
        std::fs::write(dir.join("sub/a.kif"), b"x").expect("下ごしらえ");

        std::fs::set_permissions(dir.join("sub"), std::fs::Permissions::from_mode(0o444))
            .expect("権限を落とす");
        let scanned = scan_kifu_files(&dir, &ScanOptions::default()).expect("走査");
        let _ = std::fs::set_permissions(dir.join("sub"), std::fs::Permissions::from_mode(0o755));
        let _ = std::fs::remove_dir_all(&dir);

        assert!(
            scanned.is_partial(),
            "辿れないディレクトリの中身を数え落としている。files={:?}",
            scanned.files.len()
        );
    }

    /// **読めない root は「0件」で返さない。**
    ///
    /// `exists()` は権限が無くても真を返すので、`walkdir` の `Err` を捨てると
    /// `Ok(空)` になる。呼び手はそれを差分に掛けるので、前回の全ファイルが
    /// `removed` に並んで**索引が黙って全消しされる**。
    #[cfg(unix)]
    #[test]
    fn an_unreadable_root_is_an_error_not_an_empty_scan() {
        use std::os::unix::fs::PermissionsExt;

        let dir = test_support::dir::temp_dir("scan-root");
        std::fs::write(dir.join("a.kif"), b"x").expect("下ごしらえ");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o000))
            .expect("権限を落とす");

        let got = scan_kifu_files(&dir, &ScanOptions::default());

        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755));
        let _ = std::fs::remove_dir_all(&dir);

        assert!(
            matches!(got, Err(ScanError::RootUnreadable(_))),
            "読めない root が 0件として返っている: {got:?}"
        );
    }
}
