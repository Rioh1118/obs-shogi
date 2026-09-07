//! 索引の blob をどう並べるか。**この形が変わったら `CACHE_VERSION` を上げる。**
//!
//! | ファイル | 何を持つか |
//! | --- | --- |
//! | ここ | 欄の並びと**門番**、`Codec` の実装、置く・読む手順 |
//! | `paths.rs` | プロジェクト → 名前 |
//! | `wire.rs` | バイトの原始 |
//! | `storage/` | どこへ置くか・圧縮するか |
//!
//! **門番は読み書き対称に置く。** 片側だけだと、壊れたものを書いて次の起動で
//! 読めずに作り直し、作り直してまた同じものを書く輪から抜けられない。

use std::{collections::HashMap, path::Path, path::PathBuf, sync::Arc};

use crate::search::cache::paths::{cache_key, now_ms, root_hash};
use crate::search::cache::wire::*;
use crate::search::position::position_key::PositionKey;
#[cfg_attr(not(test), allow(unused_imports))]
use crate::search::read::fs_scan::{snapshot_from_records, FileRecord, KifuKind, ScanSnapshot};
use crate::search::store::bucket::{empty_buckets, BucketEntries};
use crate::search::store::compaction::compact_bucket_entries;
use crate::search::store::file_table::FileTable;
use crate::search::store::node_table::NodeTable;
use crate::search::store::node_table::NodeTables;
use crate::search::store::snapshot::IndexSnapshot;
use crate::search::types::{FileEntry, FileId, Occurrence};
use crate::storage::{self, BlobStore, Codec, Zstd};

/// ログの接頭辞。**3つのマクロがここだけを見る。**
/// 綴りが割れるとログを grep する側が行を落とすので、直書きしない。
const LOG_PREFIX: &str = "[index cache]";

macro_rules! trace {
    ($($t:tt)*) => {
        log::debug!("{} {}", LOG_PREFIX, format_args!($($t)*));
    };
}

/// 出荷ビルドに残す、失敗ではない記録。いまは復元の統計だけ。
macro_rules! info {
    ($($t:tt)*) => {
        log::info!("{} {}", LOG_PREFIX, format_args!($($t)*));
    };
}

/// 出荷ビルドのログに残す失敗。
///
/// **`trace!` は `log::debug!` で、ロガーは `Info`**（`lib.rs`）なので出荷ビルドでは消える。
/// 消えては困るのは `save_checkpoint` の失敗だけ —— 画面には何も出ないまま
/// チェックポイントが残らず、次の起動が毎回全件構築になる（#407）。
///
/// **数える単位は「`Err` を返す出口」で、ログ呼び出しの数ではない。**
/// `save_checkpoint` の `?` はすべて `err!` を通ること。
/// `err!` の側から数えると、ログを持たない出口は集合に入らない。
///
/// **読む側（`try_restore`）では使わない。**
/// あちらは失敗しても全件構築に落ちて画面が進むので、`Info` で消えてよい。
macro_rules! err {
    ($($t:tt)*) => {
        log::error!("{} {}", LOG_PREFIX, format_args!($($t)*));
    };
}

const MAGIC: [u8; 8] = *b"OBSIXv01";

/// キャッシュの版。**容れ物の形だけでなく、棋譜の読み方が変わったときも上げる。**
///
/// 索引の項目が作り直されるのは `(size, mtime_ms)` が**変わったとき**だけ
/// （`fs_scan.rs` の `diff_snapshot`）。ファイルに触っていなければ読み直さないので、
/// **棋譜の解釈が変わっても古い解釈のまま残り続ける**。上げないと、索引と
/// 現在の読み手が食い違ったまま検索が当たる（#296 と同じ壊れ方をする）。
///
/// 版を持つのはここだけ。`MAGIC` の `v01` とキャッシュのファイル名 `index.v1.*`
/// は固定の綴りで、**上げるときはこの定数だけを動かす**。名前を変えると古い
/// ファイルがディスクに残って誰も消さないが、版で弾けば同じ名前に上書きされる。
///
/// **上げるのは「索引に入る値が変わったとき」** — どの棋譜が入るか、
/// 入った棋譜からどの `PositionKey` が出るか、のどちらかが変われば上げる。
/// 棋譜を読むクレートを上げた、読み口の判定を変えた、初期局面の組み立てを変えた、
/// 指し手の適用を変えた、はいずれも該当する。
const CACHE_VERSION: u32 = 4;

/// キャッシュから読み戻した、索引を組み直すのに要るもの。
///
/// **これはキャッシュではない。** キャッシュはディスク上の blob で、
/// これはそこから取り出した値。そのまま `IndexStore::install_restored` へ渡る。
///
/// 桶は畳んだ状態（生きている出現だけ・鍵の昇順）で入っている。
pub struct RestoredIndex {
    pub file_table: FileTable,
    pub node_tables: NodeTables,
    pub buckets: BucketEntries,
}

/// キャッシュから読み戻した、走査を続けるのに要るもの。
///
/// **索引とは別の寿命を持つ。** 索引は差し替わっても、どのファイルを
/// どの `file_id` で見ていたかは引き継ぐ必要がある。
/// そのまま `ProjectManager::install_after_full_build` へ渡る。
pub struct RestoredScan {
    /// どのファイルをどの世代で見ていたか
    pub snapshot: ScanSnapshot,
    pub path_to_id: HashMap<String, FileId>,
    /// 次に配る `file_id`。**1 から密に振った続き**
    pub next_file_id: FileId,
}

/// 読み戻した一式。
pub struct Restored {
    pub index: RestoredIndex,
    pub scan: RestoredScan,
}

struct EncodeCtx<'a> {
    root_dir: &'a Path,
    scan: &'a ScanSnapshot,
    path_to_id: &'a HashMap<String, FileId>,
    next_file_id: FileId,
    ft: &'a FileTable,
    nts: &'a NodeTables,
}

// --------------------
// public APIs
// --------------------

/// 詰めるもの。**索引そのものではない。**
///
/// 索引に入っていない `scan` / `path_to_id` / `next_file_id` も blob に載る ——
/// 復元したあと走査を続けるのに要るため（[`RestoredScan`]）。
pub struct Checkpoint<'a> {
    pub root_dir: &'a Path,
    pub snapshot: &'a IndexSnapshot,
    pub scan: &'a ScanSnapshot,
    pub path_to_id: &'a HashMap<String, FileId>,
    pub next_file_id: FileId,
}

/// 索引の blob の並べ方。
///
/// **置き場も圧縮も知らない。** 置くのは `storage` の `BlobStore`、
/// 圧縮は `storage` の `Zstd` が包む。
///
/// **門番はここに載る。** 読み書き対称に置く —— 片側だけだと、壊れたものを
/// 書いて次の起動で読めずに作り直し、作り直してまた同じものを書く輪から
/// 抜けられない。
///
/// 復号は根を要る（blob の中の root hash と突き合わせるため）ので、
/// 根を持って作る。
pub struct IndexCodec<'a> {
    pub root_dir: &'a Path,
}

impl Codec for IndexCodec<'_> {
    type Input<'a> = &'a Checkpoint<'a>;
    type Output = Restored;

    fn encode(&self, v: Self::Input<'_>) -> Result<Vec<u8>, String> {
        // 桶ごとに1本へ畳む。死んだ出現はここで落ちる
        let buckets = compact_all_buckets(v.snapshot);

        let mut body = Vec::<u8>::new();
        let ctx = EncodeCtx {
            root_dir: v.root_dir,
            scan: v.scan,
            path_to_id: v.path_to_id,
            next_file_id: v.next_file_id,
            ft: v.snapshot.file_table.as_ref(),
            nts: v.snapshot.node_tables.as_ref(),
        };
        encode_all(&mut body, &ctx, &buckets)?;
        Ok(body)
    }

    fn decode(&self, bytes: &[u8]) -> Result<Self::Output, String> {
        decode_all(bytes, self.root_dir)
    }
}

/// 索引を1つの blob に詰めて置く。
///
/// **どこへ置くかも圧縮も知らない** —— どちらも `storage` の仕事。
///
/// 落ちても呼び手は続けられる。次の起動で復元できないだけで、そのときは
/// 全件構築に落ちる。**ただし画面には何も出ない**ので、失敗は `err!` で
/// 出荷ビルドのログに残す（#407）。
pub fn save_checkpoint(
    store: &dyn BlobStore,
    root_dir: &Path,
    snap: &IndexSnapshot,
    scan: &ScanSnapshot,
    path_to_id: &HashMap<String, FileId>,
    next_file_id: FileId,
) -> Result<(), String> {
    trace!("save_checkpoint BEGIN root_dir={}", root_dir.display());

    let value = Checkpoint {
        root_dir,
        snapshot: snap,
        scan,
        path_to_id,
        next_file_id,
    };

    storage::save(
        store,
        &Zstd(IndexCodec { root_dir }),
        &cache_key(root_dir),
        &value,
    )
    .map_err(|e| {
        err!("チェックポイントを書けない: {e}");
        e
    })?;

    trace!("save_checkpoint END OK");
    Ok(())
}

/// 置いてある blob から索引を組み直す。
///
/// **失敗は正規の経路。** 初回起動・版を上げた直後・化けたときはここで失敗し、
/// 呼び手が全件構築へ落ちる（`search/commands.rs` の `open_project`）。
/// だから `err!` でなく `trace!` で記録する。
pub fn try_restore(store: &dyn BlobStore, root_dir: &Path) -> Result<Restored, String> {
    trace!("try_restore BEGIN root_dir={}", root_dir.display());

    storage::load(store, &Zstd(IndexCodec { root_dir }), &cache_key(root_dir)).map_err(|e| {
        trace!("try_restore FAILED: {e}");
        e
    })
}

// --------------------
// compaction
// --------------------

/// 桶ごとに畳んで、書き出せる素材にする。
///
/// **畳み方は `store/compaction.rs` が持つ。** ここで別に組むと、
/// 同じ鍵が並んだときの尾が食い違って、blob の並びと索引の並びがずれる。
fn compact_all_buckets(snap: &IndexSnapshot) -> BucketEntries {
    std::array::from_fn(|b| compact_bucket_entries(&snap.buckets[b], snap.file_table.as_ref()))
}

// --------------------
// binary encode/decode
// --------------------
fn encode_all(w: &mut Vec<u8>, ctx: &EncodeCtx<'_>, buckets: &BucketEntries) -> Result<(), String> {
    w.extend_from_slice(&MAGIC);
    write_u32(w, CACHE_VERSION);
    write_u64(w, now_ms());

    let rh = root_hash(ctx.root_dir);
    w.extend_from_slice(&rh);

    // file_table
    let mut entries: Vec<FileEntry> = ctx.ft.iter_all().map(|(_, e)| e).collect();
    entries.sort_by_key(|e| e.file_id);
    write_u32(w, entries.len() as u32);
    for e in &entries {
        write_u32(w, e.file_id);
        write_u32(w, e.r#gen);
        write_u8(w, if e.deleted { 1 } else { 0 });
        write_u8(w, if e.indexed { 1 } else { 0 });
        write_string(w, &e.path);
    }

    // scan
    let mut recs: Vec<FileRecord> = ctx.scan.by_path.values().cloned().collect();
    recs.sort_by(|a, b| a.path.cmp(&b.path));
    write_u32(w, recs.len() as u32);
    for r in &recs {
        write_string(w, &r.path.to_string_lossy());
        write_u8(w, kind_to_u8(r.kind));
        write_u64(w, r.size);
        write_u64(w, r.mtime_ms as u64);
    }

    // path_to_id + next_file_id
    write_u32(w, ctx.next_file_id);
    write_u32(w, ctx.path_to_id.len() as u32);
    for (p, id) in ctx.path_to_id {
        write_string(w, p);
        write_u32(w, *id);
    }

    // node tables
    let mut nt_items: Vec<(FileId, Arc<NodeTable>)> = Vec::new();
    for (i, opt) in ctx.nts.by_id_iter().enumerate() {
        if let Some(nt) = opt {
            nt_items.push((i as u32, nt.clone()));
        }
    }
    write_u32(w, nt_items.len() as u32);
    for (file_id, nt) in nt_items {
        write_u32(w, file_id);
        write_u32(w, nt.nodes.len() as u32);
        write_u32(w, nt.forks.len() as u32);
        for n in &nt.nodes {
            // 読む側と同じ範囲を見る。壊れたまま書くと、次の起動で読めずに
            // 全件作り直し、作り直してまた同じものを書く
            if n.fork_off as usize + n.fork_len as usize > nt.forks.len() {
                return Err(format!(
                    "refusing to write: fork range {}+{} is out of the fork table \
                     for file {file_id} (forks {})",
                    n.fork_off,
                    n.fork_len,
                    nt.forks.len()
                ));
            }
            write_u32(w, n.tesuu);
            write_u32(w, n.fork_off);
            write_u16(w, n.fork_len);
            write_u16(w, 0);
        }
        for f in &nt.forks {
            write_u32(w, f.te);
            write_u32(w, f.fork_index);
        }
    }

    // buckets
    //
    // **読む側と同じ検査を、書く側でも見る。** 読む側だけに置くと、壊れたものを
    // 書いて次の起動で `Err` になり、作り直してまた同じものを書く。
    //
    // ここで `Err` にすると**キャッシュが書かれない**ので、次の起動は
    // 「ファイルが無い」で全件構築になる。症状は同じだが、`save_checkpoint` の
    // 失敗としてログに出る（届く先は `#407` が広げる）
    for (b, v) in buckets.iter().enumerate() {
        write_u32(w, v.len() as u32);
        let mut prev: Option<PositionKey> = None;
        for (k, occ) in v {
            if k.bucket() as usize != b {
                return Err(format!(
                    "refusing to write: key belongs to bucket {} but is in {b}",
                    k.bucket()
                ));
            }
            if prev.is_some_and(|p| *k < p) {
                return Err(format!("refusing to write: bucket {b} is not sorted"));
            }
            prev = Some(*k);

            let nodes = match ctx.nts.get(occ.file_id) {
                Some(nt) => nt.nodes.len(),
                None => {
                    return Err(format!(
                        "refusing to write: file {} has occurrences but no node table",
                        occ.file_id
                    ))
                }
            };
            if occ.node_id as usize >= nodes {
                return Err(format!(
                    "refusing to write: node_id {} is out of range for file {} (nodes {nodes})",
                    occ.node_id, occ.file_id
                ));
            }

            write_u64(w, k.z0);
            write_u64(w, k.z1);
            write_u32(w, occ.file_id);
            write_u32(w, occ.r#gen);
            write_u32(w, occ.node_id);
        }
    }

    Ok(())
}

/// キャッシュから読んだ `file_id` を、確保の添字に使ってよい範囲に絞る。
///
/// **`FileTable` と `NodeTables` は `file_id` をそのまま `Vec` の添字にし、
/// 足りなければ `resize` する。** つまり検査せずに通すと、**壊れたキャッシュの
/// 4バイトが確保量を決める**。`0xFFFFFFFF` が1つ入っているだけで
/// 100GB 超を確保しにいき、`Err` ではなく OOM でプロセスごと落ちる。
/// 呼び手（`commands.rs` の `open_project`）は `Err` なら全件作り直しへ落ちられるが、
/// 落ちたプロセスは何も選べない。
///
/// 上限に `ft_len` を使えるのは、`file_id` が1から詰めて振られ、
/// 生きている `file_id` は必ずファイル表に項目を持つから
/// （`FileTable::iter_all` は空のスロットを飛ばすので、項目数＝最大の `file_id`）。
/// その `ft_len` 自身は [`Reader::read_len`] が残りバイト数で縛るので、
/// **確保量は blob の長さで頭打ちになる**。
/// **`file_id` が疎になる経路は実在する**（`build.rs` の join error）。
/// そのとき外れる方向は「捨てて作り直す」側なので、ここは安全側に倒れる。
///
/// `zstd` は checksum 無しで書いているのでビット化けを捕まえない（#336）。
/// 化けた値がここに届くことは前提にしてよい。
fn checked_file_id(file_id: FileId, ft_len: usize) -> Result<FileId, String> {
    if file_id as usize > ft_len {
        return Err(format!("bad file_id: {file_id} (file_table len {ft_len})"));
    }
    Ok(file_id)
}

/// 1項目が blob 上で占める最小のバイト数。**[`Reader::read_len`] の上限に使う。**
///
/// 可変長（文字列）を含む項目は、長さの欄だけを数えて中身を0バイトとする。
/// 上限として使うので、**小さく見積もるぶんには安全側**（通す範囲が広くなるだけ）。
mod min_bytes {
    /// `file_id` + `gen` + `deleted` + `indexed` + パスの長さ
    pub(super) const FILE_ENTRY: usize = 4 + 4 + 1 + 1 + 4;
    /// パスの長さ + `kind` + `size` + `mtime_ms`
    pub(super) const FILE_RECORD: usize = 4 + 1 + 8 + 8;
    /// パスの長さ + `file_id`
    pub(super) const PATH_TO_ID: usize = 4 + 4;
    /// `file_id` + ノード数 + 分岐数
    pub(super) const NODE_TABLE: usize = 4 + 4 + 4;
    /// `tesuu` + `fork_off` + `fork_len` + 詰め物
    pub(super) const NODE: usize = 4 + 4 + 2 + 2;
    /// `te` + `fork_index`
    pub(super) const FORK: usize = 4 + 4;
    /// `z0` + `z1` + `file_id` + `gen` + `node_id`
    pub(super) const OCCURRENCE: usize = 8 + 8 + 4 + 4 + 4;
}

fn decode_all(bytes: &[u8], root_dir: &Path) -> Result<Restored, String> {
    let mut r = Reader::new(bytes);

    let magic = r.read_fixed::<8>()?;
    if magic != MAGIC {
        return Err("bad magic".to_string());
    }

    let ver = r.read_u32()?;
    if ver != CACHE_VERSION {
        return Err(format!("bad version: {ver}"));
    }

    let _created_ms = r.read_u64()?;

    let saved_root_hash = r.read_fixed::<32>()?;
    let expect = root_hash(root_dir);
    if saved_root_hash != expect {
        return Err("root hash mismatch (different project root)".to_string());
    }
    // ---- file_table ----
    let ft_len = r.read_len(min_bytes::FILE_ENTRY)?;
    let mut ft = FileTable::default();
    for _ in 0..ft_len {
        let file_id = checked_file_id(r.read_u32()?, ft_len)?;
        let gen_val = r.read_u32()?;
        let deleted = r.read_u8()? != 0;
        let indexed = r.read_u8()? != 0;
        let path = r.read_string()?;
        ft.upsert(FileEntry {
            file_id,
            r#gen: gen_val,
            deleted,
            indexed,
            path,
        });
    }

    // ---- scan snapshot ----
    let rec_len = r.read_len(min_bytes::FILE_RECORD)?;
    let mut records: Vec<FileRecord> = Vec::with_capacity(rec_len);
    for _ in 0..rec_len {
        let path = PathBuf::from(r.read_string()?);
        let kind = u8_to_kind(r.read_u8()?)?;
        let size = r.read_u64()?;
        let mtime_ms = r.read_u64()? as u128;
        records.push(FileRecord {
            path,
            kind,
            size,
            mtime_ms,
        });
    }

    let scan = snapshot_from_records(root_dir, records);

    // ---- path_to_id / next_file_id ----
    let next_file_id = r.read_u32()?;
    let map_len = r.read_len(min_bytes::PATH_TO_ID)?;
    let mut path_to_id = HashMap::with_capacity(map_len);
    for _ in 0..map_len {
        let p = r.read_string()?;
        let id = checked_file_id(r.read_u32()?, ft_len)?;
        path_to_id.insert(p, id);
    }

    // ---- node tables ----
    let nt_len = r.read_len(min_bytes::NODE_TABLE)?;
    let mut nts = NodeTables::default();
    // 節表の `file_id` は狭義単調増加。根拠は `encode_all` の `node tables` の節で、
    // `by_id` は `file_id` を添字にした `Vec<Option<_>>` なので
    // `by_id_iter().enumerate()` の添字がそのまま `file_id` になる
    // （`None` は飛ばすだけで、順も重複も作らない）。
    //
    // これを見ないと `NodeTables::upsert` が黙って上書きする。後の節表の `file_id` が
    // 1ビット化けて前のものに一致すると（`7 → 5`）、前のファイルの節表が差し替わり、
    // **そのファイルの全ヒットが別の棋譜の `tesuu` / `fork_path` を持つ。**
    // 出現側の `node_id` 検査は節数が足りていれば通るので気付けない。
    // `node_id` の化けは0手目に落ちるので気付けるが、**こちらはそれらしい局面が出る。**
    let mut prev_nt_file_id: Option<FileId> = None;
    for _ in 0..nt_len {
        let file_id = checked_file_id(r.read_u32()?, ft_len)?;
        if let Some(prev) = prev_nt_file_id {
            if file_id <= prev {
                return Err(format!("node table file_id {file_id} is not after {prev}"));
            }
        }
        prev_nt_file_id = Some(file_id);
        let nodes_len = r.read_len(min_bytes::NODE)?;
        let forks_len = r.read_len(min_bytes::FORK)?;

        let mut nt = NodeTable::empty();
        nt.nodes.reserve(nodes_len);
        nt.forks.reserve(forks_len);

        for _ in 0..nodes_len {
            let tesuu = r.read_u32()?;
            let fork_off = r.read_u32()?;
            let fork_len = r.read_u16()?;
            let _pad = r.read_u16()?;

            // 節が指す分岐の範囲。**`node_id` と同じ壊れ方をする**
            if fork_off as usize + fork_len as usize > forks_len {
                return Err(format!(
                    "fork range {fork_off}+{fork_len} is out of the fork table \
                     for file {file_id} (forks {forks_len})"
                ));
            }

            nt.nodes.push(crate::search::store::node_table::NodeCursor {
                tesuu,
                fork_off,
                fork_len,
            });
        }
        for _ in 0..forks_len {
            let te = r.read_u32()?;
            let fork_index = r.read_u32()?;
            nt.forks
                .push(crate::search::store::node_table::ForkPtr { te, fork_index });
        }

        nts.upsert(file_id, Arc::new(nt));
    }

    // ---- buckets ----
    //
    // **読んだ並びがそのまま索引の並びになる。** `IndexSnapshot::restored` は
    // 並び替えず `Segment::new_sorted` へ渡し、`Segment` は昇順を前提に二分探索する。
    // ここで検査しないと、崩れた並びが黙って通って**検索が0件になる** —
    // エラーも警告もログも出ず、`(size, mtime)` が変わらないので再起動しても直らない。
    //
    // `Err` を返せば呼び手が全件作り直しへ落ちられる（`commands.rs`）。
    // `checked_file_id` の doc が言うとおり、化けた値がここに届くのは前提でよい。
    let mut buckets: BucketEntries = empty_buckets();
    for (b, bucket) in buckets.iter_mut().enumerate() {
        let n = r.read_len(min_bytes::OCCURRENCE)?;
        let mut v = Vec::with_capacity(n);
        let mut prev: Option<PositionKey> = None;
        for _ in 0..n {
            let z0 = r.read_u64()?;
            let z1 = r.read_u64()?;
            let file_id = checked_file_id(r.read_u32()?, ft_len)?;
            let gen_val = r.read_u32()?;
            let node_id = r.read_u32()?;

            let key = PositionKey { z0, z1 };
            if key.bucket() as usize != b {
                return Err(format!(
                    "key belongs to bucket {} but was stored in {b}",
                    key.bucket()
                ));
            }
            if prev.is_some_and(|p| key < p) {
                return Err(format!("bucket {b} is not sorted"));
            }
            prev = Some(key);

            // 節表はここより前に読み終わっているので、範囲を突き合わせられる。
            // **範囲内の別の節を指す化け方は通る** — 値としてあり得るので見分けられない
            // 出現を持つ `file_id` は必ず節表を持つ。対で入れるのは
            // `store/snapshot.rs` の `with_files` だけで、あれは
            // `(FileEntry, NodeTableArc, BucketEntries)` の三つ組を受ける。
            // 復元の `restored` は表を丸ごと別々の引数で受けるので対を
            // 担保しない —— **復元の経路でこの不変条件を保つのはこの検査自身。**
            //
            // **表が無いことも壊れている合図。**
            let nodes = match nts.get(file_id) {
                Some(nt) => nt.nodes.len(),
                None => return Err(format!("file {file_id} has occurrences but no node table")),
            };
            if node_id as usize >= nodes {
                return Err(format!(
                    "node_id {node_id} is out of range for file {file_id} (nodes {nodes})"
                ));
            }

            v.push((
                key,
                Occurrence {
                    file_id,
                    r#gen: gen_val,
                    node_id,
                },
            ));
        }
        *bucket = v;
    }
    let total_bucket_entries: usize = buckets.iter().map(|v| v.len()).sum();
    let nt_some: usize = nts.by_id_iter().filter(|x| x.is_some()).count();

    info!(
    "restored stats: file_table_len={} node_tables_some={} scan_paths={} path_to_id_len={} next_file_id={} bucket_entries_total={}",
    ft.len(),
    nt_some,
    scan.by_path.len(),
    path_to_id.len(),
    next_file_id,
    total_bucket_entries,
);

    Ok(Restored {
        index: RestoredIndex {
            file_table: ft,
            node_tables: nts,
            buckets,
        },
        scan: RestoredScan {
            snapshot: scan,
            path_to_id,
            next_file_id,
        },
    })
}

/// 門番のテストは、**どちらの側を見ているかを名前で名乗る。**
///
/// | 綴り | 見ているもの |
/// | --- | --- |
/// | `..._not_written` | `encode_all` だけ |
/// | `..._refused` | `decode_all` だけ |
/// | `..._neither_written_nor_read` | 両方 |
///
/// 名前の側には主語に合わせて `is` / `are` が入る。
/// **数えるときは copula を挟まない綴りで引く。**
///
/// **`rejected` を使わない。** `refused` と同じ意味で綴りが割れると、
/// 上の3つで数えたときに集合の外に落ちる。
///
/// **読む側を数えるなら `_refused` と `_neither_written_nor_read` の両方、
/// 書く側なら `_not_written` と `_neither_written_nor_read` の両方。**
/// 本数はここに書かない —— 書く側の網羅は
/// `tests/index_cache_guard_names.rs` が文言で見る。
///
/// **ヘッダの検査は対象外。** 版 / magic / root hash / 長さ / `file_id` を見る
/// テストは、何を守っているかを名前に持つ（`..._cannot_be_read` など）。
///
/// **書き側の門番の文言は `refusing to write: ` で始める。**
/// 違うと `Err` を作る数と文言の数が合わなくなり、あのラチェットが落ちる。
///
/// `is_err()` で終わらせないこと。**別の門番を踏んでも緑になる。**
#[cfg(test)]
mod tests {
    use super::*;

    /// 前の版で書かれた索引は読まない。
    ///
    /// 読んでしまうと、棋譜の解釈が変わったあとも古い索引が残る。
    /// `try_restore` が `Err` を返すと呼び手（`commands.rs` の `open_project`）は
    /// 全件の作り直しへ落ちるので、捨てて損はない。
    #[test]
    fn an_index_written_by_an_older_version_cannot_be_read() {
        let mut blob = Vec::new();
        blob.extend_from_slice(&MAGIC);
        write_u32(&mut blob, CACHE_VERSION - 1);

        // Restored は Debug を実装していないので expect_err は使えない
        let Err(err) = decode_all(&blob, Path::new("/tmp")) else {
            panic!("前の版の索引を読んでしまった");
        };
        assert!(err.contains("bad version"), "理由が版でない: {err}");
    }

    /// 今の版で書いたものは、版の検査を通り抜ける。
    ///
    /// 上のテストだけだと、`CACHE_VERSION` をいくつにしても通る。
    #[test]
    fn the_current_version_passes_the_version_check() {
        let mut blob = Vec::new();
        blob.extend_from_slice(&MAGIC);
        write_u32(&mut blob, CACHE_VERSION);

        let Err(err) = decode_all(&blob, Path::new("/tmp")) else {
            panic!("本体が無いので失敗するはず");
        };
        assert!(!err.contains("bad version"), "今の版が弾かれている: {err}");
    }

    /// 退役した版の最大値。**[`CACHE_VERSION`] のすぐ下の値をリテラルで持つ。**
    ///
    /// この2つの関係は下の `const _` がコンパイル時に見ているので、
    /// **どちらかだけを動かすと `cargo test` / `cargo clippy --all-targets` が落ちる**
    /// （`const _` が `#[cfg(test)]` の中にあるので、`cargo build` だけでは通る）。
    /// 留めているのは言語ではなく、Rust を触ったら `verify:rust` を必ず走らせる
    /// `verify-gate.sh` のほう。
    const LATEST_RETIRED_CACHE_VERSION: u32 = 3;

    /// 過ぎた版の索引を、二度と受け入れない。
    ///
    /// `the_current_version_passes_the_version_check` と
    /// `a_file_that_is_not_an_index_cannot_be_read` は `CACHE_VERSION` そのものを使って
    /// blob を組むので、値がいくつでも通る。**[`CACHE_VERSION`] を留めるものが他に無い。**
    /// 前の版に戻ると、その版が書いた索引がそのまま読まれ、
    /// `(size, mtime_ms)` が変わっていない棋譜は古い解釈のまま検索に当たり続ける。
    /// 警告も出ない。
    #[test]
    fn superseded_versions_are_never_accepted_again() {
        // **等号で留める。** 不等号（`CACHE_VERSION > LATEST_RETIRED_CACHE_VERSION`）だと
        // 下げたときしか落ちない — 版を上げて `LATEST_RETIRED_CACHE_VERSION` を
        // 据え置くと、間の版を一度も試さないまま緑で通る。
        // 実行時の `assert!` は定数なので clippy が断る。コンパイル時に見る
        const _: () = assert!(
            CACHE_VERSION == LATEST_RETIRED_CACHE_VERSION + 1,
            "`CACHE_VERSION` と `LATEST_RETIRED_CACHE_VERSION` は一緒に動かすこと"
        );

        for old in 1..=LATEST_RETIRED_CACHE_VERSION {
            let mut blob = MAGIC.to_vec();
            write_u32(&mut blob, old);

            let Err(err) = decode_all(&blob, Path::new("/tmp")) else {
                panic!("版 {old} が書いた索引を読んでしまった");
            };
            assert!(
                err.contains("bad version"),
                "版 {old}: 理由が版でない: {err}"
            );
        }
    }

    /// 索引でないファイルを索引として読まない。
    ///
    /// キャッシュの置き場に別のものが入っていても、中身を信じて進まない。
    #[test]
    fn a_file_that_is_not_an_index_cannot_be_read() {
        let mut blob = b"PK\x03\x04....".to_vec();
        write_u32(&mut blob, CACHE_VERSION);

        let Err(err) = decode_all(&blob, Path::new("/tmp")) else {
            panic!("索引でないファイルを読んでしまった");
        };
        assert!(err.contains("bad magic"), "理由が magic でない: {err}");
    }

    /// 別のプロジェクトの索引を、今のプロジェクトの索引として復元しない。
    ///
    /// 通してしまうと、検索結果に**別のフォルダの棋譜のパス**が並ぶ。
    /// 開こうとしても無いので、利用者から見ると「検索が壊れている」になる。
    #[test]
    fn an_index_built_for_another_project_cannot_be_read() {
        let mut blob = header_for(Path::new("/tmp/project-a"));
        write_u32(&mut blob, 0);

        let Err(err) = decode_all(&blob, Path::new("/tmp/project-b")) else {
            panic!("別のプロジェクトの索引を読んでしまった");
        };
        assert!(err.contains("root hash"), "理由が root hash でない: {err}");
    }

    /// 版の検査を通ったところまでの blob を組む。
    fn header_for(root_dir: &Path) -> Vec<u8> {
        let mut blob = Vec::new();
        blob.extend_from_slice(&MAGIC);
        write_u32(&mut blob, CACHE_VERSION);
        write_u64(&mut blob, 0);
        blob.extend_from_slice(&root_hash(root_dir));
        blob
    }

    /// 壊れた `file_id` は `Err` になる。**確保しにいかない。**
    ///
    /// `FileTable` は `file_id` をそのまま `Vec` の添字にして `resize` するので、
    /// 検査せずに通すと 74 バイトのファイルが 100GB 超の確保を要求する。
    /// 出るのは `Err` ではなく SIGKILL で、利用者から見ると
    /// 「プロジェクトを開くたびにアプリが固まって落ちる」になる。
    /// `zstd` を checksum 無しで書いている（#336）以上、化けた値はここに届く。
    #[test]
    fn a_file_id_from_a_corrupt_cache_cannot_decide_how_much_to_allocate() {
        let root = Path::new("/tmp");
        let mut blob = header_for(root);
        write_u32(&mut blob, 1); // ファイル表の項目数
        write_u32(&mut blob, u32::MAX); // 壊れた file_id
        write_u32(&mut blob, 0);
        write_u8(&mut blob, 0);
        write_string(&mut blob, "a.kif");

        let Err(err) = decode_all(&blob, root) else {
            panic!("壊れた file_id を受け入れてしまった");
        };
        assert!(err.contains("bad file_id"), "理由が file_id でない: {err}");
    }

    /// 壊れた**長さの欄**も確保量を決められない。
    ///
    /// `file_id` だけを縛っても足りない。とくに `HashMap::with_capacity` は
    /// hashbrown が制御バイトを埋めるので遅延予約にならず、
    /// 68バイトの blob で 1.08 GB / 353 ms を実測している。
    /// 実プロジェクトの項目数は小さいので、**最上位ビットが1つ反転するだけで
    /// 20億を超える**。`zstd` は checksum 無しなので化けた値はここに届く（#336）。
    ///
    /// **欄ごとに1件ずつ見る。** 1つの欄だけを見る題材では、
    /// 他の欄を無検査に戻す変更が緑のまま通る。
    #[test]
    fn a_corrupt_length_cannot_decide_how_much_to_allocate() {
        let root = Path::new("/tmp");

        // 正しいところまで組んで、狙った欄だけを壊す。
        // 手前の欄は空（長さ0）にして通す
        let prefixes: [(&str, usize); 5] = [
            ("file_table", 0),
            ("scan_records", 1),
            ("path_to_id", 2),
            ("node_tables", 3),
            ("buckets", 4),
        ];
        for (label, zeros_before) in prefixes {
            let mut blob = header_for(root);
            for i in 0..zeros_before {
                write_u32(&mut blob, 0);
                // `path_to_id` の手前には `next_file_id` が挟まる
                if i == 1 {
                    write_u32(&mut blob, 1);
                }
            }
            write_u32(&mut blob, u32::MAX);

            let Err(err) = decode_all(&blob, root) else {
                panic!("{label}: 壊れた長さを受け入れてしまった");
            };
            assert!(
                err.contains("bad length"),
                "{label}: 理由が長さでない: {err}"
            );
        }

        // ノード表の中の2つは、表を1つ通してからでないと届かない。
        // 手前を空にするだけの組み立てでは素通りする
        for (label, forks_broken) in [("nodes_len", false), ("forks_len", true)] {
            let mut blob = header_for(root);
            write_u32(&mut blob, 0); // file_table
            write_u32(&mut blob, 0); // scan records
            write_u32(&mut blob, 1); // next_file_id
            write_u32(&mut blob, 0); // path_to_id
            write_u32(&mut blob, 1); // node_tables: 1件
            write_u32(&mut blob, 0); // file_id
            write_u32(&mut blob, if forks_broken { 0 } else { u32::MAX });
            write_u32(&mut blob, if forks_broken { u32::MAX } else { 0 });

            let Err(err) = decode_all(&blob, root) else {
                panic!("{label}: 壊れた長さを受け入れてしまった");
            };
            assert!(
                err.contains("bad length"),
                "{label}: 理由が長さでない: {err}"
            );
        }
    }

    /// 形式の綴りと読みが対で動くこと。
    ///
    /// 片方だけ動かすと、復元した索引の全 `.kif` が `.ki2` になる
    /// といった形で**読み直しの形式が入れ替わる**。
    #[test]
    fn every_kifu_kind_survives_a_round_trip() {
        for kind in [KifuKind::Kif, KifuKind::Ki2, KifuKind::Csa, KifuKind::Jkf] {
            let back = u8_to_kind(kind_to_u8(kind)).expect("読み戻せない");
            assert_eq!(back, kind, "{kind:?} の綴りと読みが対になっていない");
        }
    }

    /// [`min_bytes`] の7つの値が、`encode_all` が実際に書く最小より大きくないこと。
    ///
    /// 大きく見積もると [`Reader::read_len`] が正当な長さを弾き、
    /// **本物のキャッシュが毎回捨てられる**。呼び手は全件作り直しへ落ちるだけなので、
    /// 利用者に見えるのは「起動が毎回遅い」だけで原因を辿る手掛かりが無い。
    ///
    /// **節ごとに、その節で blob が終わる形を組む。** 後ろに何か続いていると
    /// そのバイトが余裕として効いてしまい、見積もりの誤りが埋もれる
    /// （実際、末尾の節である `OCCURRENCE` 以外は本物大の往復テストでも捕まらない）。
    /// 可変長は長さ0で書くので、1項目ぶんがちょうど最小になる。
    ///
    /// `cargo-mutants` は定数の増減を変異に持たないので、**ここでしか守れない**。
    #[test]
    fn no_min_bytes_estimate_is_larger_than_what_is_written() {
        let root = Path::new("/tmp");

        // (節の名前, その節までの前置き, 1項目ぶんの最小バイト列)
        /// blob に書き足す1手（前置き / 1項目）
        type Write = dyn Fn(&mut Vec<u8>);
        let cases: [(&str, &Write, &Write); 7] = [
            ("FILE_ENTRY", &|_b: &mut Vec<u8>| {}, &|b: &mut Vec<u8>| {
                write_u32(b, 0); // file_id
                write_u32(b, 0); // gen
                write_u8(b, 0); // deleted
                write_u8(b, 0); // indexed
                write_u32(b, 0); // 長さ0のパス
            }),
            (
                "FILE_RECORD",
                &|b: &mut Vec<u8>| write_u32(b, 0),
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0); // 長さ0のパス
                    write_u8(b, 1); // kind
                    write_u64(b, 0); // size
                    write_u64(b, 0); // mtime_ms
                },
            ),
            (
                "PATH_TO_ID",
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0); // file_table
                    write_u32(b, 0); // scan records
                    write_u32(b, 1); // next_file_id
                },
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0); // 長さ0のパス
                    write_u32(b, 0); // file_id
                },
            ),
            (
                "NODE_TABLE",
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0);
                    write_u32(b, 0);
                    write_u32(b, 1);
                    write_u32(b, 0);
                },
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0); // file_id
                    write_u32(b, 0); // nodes_len
                    write_u32(b, 0); // forks_len
                },
            ),
            (
                "NODE",
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0);
                    write_u32(b, 0);
                    write_u32(b, 1);
                    write_u32(b, 0);
                    write_u32(b, 1); // node_tables: 1件
                    write_u32(b, 0); // file_id
                },
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0); // tesuu
                    write_u32(b, 0); // fork_off
                    write_u16(b, 0); // fork_len
                    write_u16(b, 0); // 詰め物
                },
            ),
            (
                "FORK",
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0);
                    write_u32(b, 0);
                    write_u32(b, 1);
                    write_u32(b, 0);
                    write_u32(b, 1);
                    write_u32(b, 0); // file_id
                    write_u32(b, 0); // nodes_len
                },
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0); // te
                    write_u32(b, 0); // fork_index
                },
            ),
            (
                "OCCURRENCE",
                &|b: &mut Vec<u8>| {
                    write_u32(b, 0);
                    write_u32(b, 0);
                    write_u32(b, 1);
                    write_u32(b, 0);
                    // node_tables: file_id 0 に節を1つ。
                    // **出現を持つ file_id は節表を持つ**という不変条件を
                    // decode が見るので、題材もそれに揃える
                    write_u32(b, 1); // 表は1つ
                    write_u32(b, 0); // file_id
                    write_u32(b, 1); // nodes_len
                    write_u32(b, 0); // forks_len
                    write_u32(b, 0); // tesuu
                    write_u32(b, 0); // fork_off
                    write_u16(b, 0); // fork_len
                    write_u16(b, 0); // pad
                },
                &|b: &mut Vec<u8>| {
                    write_u64(b, 0); // z0
                    write_u64(b, 0); // z1
                    write_u32(b, 0); // file_id
                    write_u32(b, 0); // gen
                    write_u32(b, 0); // node_id
                },
            ),
        ];

        for (label, prefix, one_item) in cases {
            let mut blob = header_for(root);
            prefix(&mut blob);
            write_u32(&mut blob, 1); // その節の項目数
            one_item(&mut blob);
            // ここで blob は終わり。**この節の余裕はゼロ**

            match decode_all(&blob, root) {
                // 節を読み切ってから、後続の節でバイトが尽きる。これが正しい
                Err(e) if e.contains("unexpected eof") => {}
                // 見積もりが大きいと、項目を読む前に長さで弾かれる
                Err(e) if e.contains("bad length") => {
                    panic!("{label}: 実際に書かれる最小より大きく見積もっている: {e}")
                }
                Err(e) => panic!("{label}: 想定しない理由で失敗した: {e}"),
                Ok(_) => panic!("{label}: 後続の節が無いのに読めてしまった"),
            }
        }
    }

    /// **本物の大きさの索引が読み戻せること。**
    ///
    /// [`min_bytes`] の値を1つでも大きく見積もると、[`Reader::read_len`] が
    /// 正当な長さを「残りバイト数を超える」と判定して `Err` になる。
    /// 呼び手は `log::warn!` して全件作り直しへ落ちるだけなので、
    /// **利用者に見えるのは「起動が毎回遅い」だけ**で、原因を辿る手掛かりが無い。
    ///
    /// とくに危ないのは `OCCURRENCE`。**buckets は blob の最後の区間**なので
    /// `n * OCCURRENCE` が残りバイト数とぴったり等しくなり、余裕がゼロになる。
    /// 手前の区間は後続のバイトが余裕として効いてしまうので、
    /// 小さい題材ではこの誤りが埋もれる。
    ///
    /// `cargo-mutants` は定数の増減を変異に持たないので、
    /// **`min_bytes` を守れるのはこのテストだけ**。
    #[test]
    fn an_index_of_a_realistic_size_can_be_read_back() {
        use crate::search::store::node_table::NodeTableBuilder;
        use crate::search::types::ForkPointer;

        const FILES: u32 = 300;
        const NODES_PER_FILE: u32 = 40;
        const OCCS: u32 = 4_000;

        let root = Path::new("/tmp/obs-shogi-realistic");

        // パスは長いほうが厳しい（可変長を0バイトと見積もっているので、
        // 長いパスは余裕を増やす方向。短いパスのほうが境界に近い）
        let path_of = |i: u32| format!("dir{}/kifu-{i}.kif", i % 17);

        let mut ft = FileTable::default();
        let mut path_to_id: HashMap<String, FileId> = HashMap::new();
        let mut records: Vec<FileRecord> = Vec::new();
        let mut nts = NodeTables::default();

        for i in 1..=FILES {
            ft.upsert(FileEntry {
                file_id: i,
                path: path_of(i),
                deleted: false,
                indexed: true,
                r#gen: 1,
            });
            path_to_id.insert(path_of(i), i);
            records.push(FileRecord {
                path: root.join(path_of(i)),
                kind: KifuKind::Kif,
                size: 4096,
                mtime_ms: 1_700_000_000_000,
            });

            // **本番の口を通す。** 手で `NodeCursor` を組むと
            // `push_node` が保つ `fork_off + fork_len <= forks.len()` を
            // 迂回してしまい、書き側の門番が本番の形で試されない
            let mut b = NodeTableBuilder::new();
            for n in 0..NODES_PER_FILE {
                let path: Vec<ForkPointer> = (0..(n % 3))
                    .map(|f| ForkPointer {
                        te: f,
                        fork_index: f,
                    })
                    .collect();
                b.push_node(n, &path);
            }
            nts.upsert(i, Arc::new(b.finish()));
        }

        let mut buckets: BucketEntries = empty_buckets();
        for i in 0..OCCS {
            let z0 = u64::from(i).wrapping_mul(0x9E37_79B9_7F4A_7C15);
            let key = PositionKey { z0, z1: !z0 };
            buckets[key.bucket() as usize].push((
                key,
                Occurrence {
                    file_id: (i % FILES) + 1,
                    r#gen: 1,
                    node_id: i % NODES_PER_FILE,
                },
            ));
        }
        // **本番は必ず整列済みの桶を書く**（`bucketize_entries` も
        // `compact_bucket_entries` の k-way マージも昇順を出す）。題材もそれに揃える —
        // 揃えないと `decode_all` の並びの検査が「壊れたキャッシュ」として弾く
        for b in buckets.iter_mut() {
            b.sort_by_key(|(k, _)| *k);
        }
        let written: usize = buckets.iter().map(Vec::len).sum();

        let mut blob = Vec::new();
        encode_all(
            &mut blob,
            &EncodeCtx {
                root_dir: root,
                scan: &snapshot_from_records(root, records),
                path_to_id: &path_to_id,
                next_file_id: FILES + 1,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect("書けない");

        let Ok(back) = decode_all(&blob, root) else {
            panic!("本物の大きさの索引を読み戻せない（min_bytes を大きく見積もっている）");
        };
        assert_eq!(back.index.file_table.len(), FILES as usize);
        assert_eq!(back.scan.snapshot.by_path.len(), FILES as usize);
        assert_eq!(back.scan.path_to_id.len(), FILES as usize);
        assert_eq!(
            back.index.buckets.iter().map(Vec::len).sum::<usize>(),
            written,
            "出現が欠けた"
        );
        assert_eq!(
            back.index
                .node_tables
                .by_id_iter()
                .filter(|x| x.is_some())
                .count(),
            FILES as usize
        );
    }

    /// 書いたものが**そのまま**読み戻せること。
    ///
    /// ここが崩れると、索引の中身が黙って別の意味になる。バイト位置が
    /// 1つずれるだけで `fork_off` / `fork_len` が全部でたらめになり、
    /// 検索は当たるのにそのヒットが別の節を指す。
    /// ヘッダ12バイトで止まるテストでは、そこまで届かない。
    ///
    /// **`CACHE_VERSION` を上げた版に更新した利用者は、次の起動で必ず1回ここを通る。**
    #[test]
    fn what_is_written_to_the_cache_is_what_is_read_back() {
        use crate::search::store::node_table::{ForkPtr, NodeCursor};

        let root = Path::new("/tmp/obs-shogi-roundtrip");

        let mut ft = FileTable::default();
        for (file_id, path, deleted) in [(1u32, "a.kif", false), (2u32, "変化.ki2", true)] {
            ft.upsert(FileEntry {
                file_id,
                path: path.to_owned(),
                deleted,
                indexed: true,
                r#gen: file_id + 40,
            });
        }

        let mut nt = NodeTable::empty();
        nt.nodes.push(NodeCursor {
            tesuu: 7,
            fork_off: 0,
            fork_len: 2,
        });
        nt.nodes.push(NodeCursor {
            tesuu: 9,
            fork_off: 2,
            fork_len: 0,
        });
        nt.forks.push(ForkPtr {
            te: 3,
            fork_index: 0,
        });
        nt.forks.push(ForkPtr {
            te: 5,
            fork_index: 1,
        });
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(nt));
        // 出現を持つ `file_id` は節表も持つ
        {
            let mut nt2 = NodeTable::empty();
            nt2.nodes.push(NodeCursor {
                tesuu: 0,
                fork_off: 0,
                fork_len: 0,
            });
            nt2.nodes.push(NodeCursor {
                tesuu: 1,
                fork_off: 0,
                fork_len: 0,
            });
            nts.upsert(2, Arc::new(nt2));
        }

        let records = vec![
            FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-roundtrip/a.kif"),
                kind: KifuKind::Kif,
                size: 4096,
                mtime_ms: 1_700_000_000_000,
            },
            FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-roundtrip/変化.ki2"),
                kind: KifuKind::Ki2,
                size: 77,
                mtime_ms: 1_700_000_000_001,
            },
        ];
        let scan = snapshot_from_records(root, records);

        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32), ("変化.ki2".to_owned(), 2u32)]
                .into_iter()
                .collect();

        // 別々の桶に落ちる鍵を選ぶ。**桶は鍵に決めさせる** — 手で置くと
        // `bucketize_entries` が作らない配置を題材が固定してしまい、
        // 引く側（`snapshot` は `key.bucket()` の桶しか見ない）と食い違う
        let k1 = PositionKey {
            z0: 0x1100_0000_0000_0000,
            z1: 0x2222,
        };
        let k2 = PositionKey {
            z0: 0x2200_0000_0000_0000,
            z1: 0x3333,
        };
        assert_ne!(k1.bucket(), k2.bucket(), "題材が同じ桶に落ちている");

        let mut buckets: BucketEntries = empty_buckets();
        buckets[k1.bucket() as usize].push((
            k1,
            Occurrence {
                file_id: 1,
                r#gen: 41,
                node_id: 0,
            },
        ));
        buckets[k2.bucket() as usize].push((
            k2,
            Occurrence {
                file_id: 2,
                r#gen: 42,
                node_id: 1,
            },
        ));

        let mut blob = Vec::new();
        encode_all(
            &mut blob,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 3,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect("書けない");

        let Ok(back) = decode_all(&blob, root) else {
            panic!("書いたものを読み戻せない");
        };

        assert_eq!(back.scan.next_file_id, 3);
        assert_eq!(back.scan.path_to_id, path_to_id);

        for file_id in [1u32, 2] {
            let before = ft.get(file_id).expect("元のファイル表に無い");
            let after = back
                .index
                .file_table
                .get(file_id)
                .expect("読み戻せていない");
            assert_eq!(
                (after.path, after.deleted, after.r#gen),
                (before.path, before.deleted, before.r#gen),
                "file_id={file_id}"
            );
        }

        for (key, rec) in &scan.by_path {
            let after = back
                .scan
                .snapshot
                .by_path
                .get(key)
                .expect("走査結果が欠けた");
            assert_eq!(
                (after.kind, after.size, after.mtime_ms),
                (rec.kind, rec.size, rec.mtime_ms),
                "{:?}",
                rec.path
            );
        }

        let after_nt = back.index.node_tables.get(1).expect("ノード表が欠けた");
        assert_eq!(
            after_nt
                .nodes
                .iter()
                .map(|n| (n.tesuu, n.fork_off, n.fork_len))
                .collect::<Vec<_>>(),
            vec![(7, 0, 2), (9, 2, 0)],
        );
        assert_eq!(
            after_nt
                .forks
                .iter()
                .map(|f| (f.te, f.fork_index))
                .collect::<Vec<_>>(),
            vec![(3, 0), (5, 1)],
        );

        let flat = |bs: &BucketEntries| {
            bs.iter()
                .flatten()
                .map(|(k, o)| (k.z0, k.z1, o.file_id, o.r#gen, o.node_id))
                .collect::<Vec<_>>()
        };
        assert_eq!(flat(&back.index.buckets), flat(&buckets));
    }
    /// **崩れた桶は読まずに `Err` にする。**
    ///
    /// 読んだ並びがそのまま索引の並びになり、`Segment` は昇順を前提に二分探索する。
    /// 通してしまうと検索が0件になるだけで、エラーも警告もログも出ない。
    /// `(size, mtime)` が変わらないので再起動しても直らない。
    ///
    /// `Err` なら呼び手が全件作り直しへ落ちられる（`commands.rs`）。
    /// `checked_file_id` の doc が言うとおり、`zstd` は checksum を書いていないので
    /// 化けた値がここに届くのは前提でよい。
    #[test]
    fn a_bucket_that_is_out_of_order_or_in_the_wrong_place_is_neither_written_nor_read() {
        let root = Path::new("/tmp/obs-shogi-bucket-guard");
        let mut ft = FileTable::default();
        ft.upsert(FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            r#gen: 1,
        });
        // **出現を持つ `file_id` は節表も持つ**（本番の口が対でしか入れない）。
        // 題材もそれに揃える
        let mut nt = NodeTable::empty();
        nt.nodes.push(crate::search::store::node_table::NodeCursor {
            tesuu: 0,
            fork_off: 0,
            fork_len: 0,
        });
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(nt));

        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();

        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-bucket-guard/a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );
        let ctx = || EncodeCtx {
            root_dir: root,
            scan: &scan,
            path_to_id: &path_to_id,
            next_file_id: 2,
            ft: &ft,
            nts: &nts,
        };
        let encode = |buckets: &BucketEntries| {
            let mut blob = Vec::new();
            encode_all(&mut blob, &ctx(), buckets).expect("書けない");
            blob
        };
        let occ = Occurrence {
            file_id: 1,
            r#gen: 1,
            node_id: 0,
        };

        // 同じ桶に落ちる2つ
        let lo = PositionKey {
            z0: 0x1100_0000_0000_0001,
            z1: 0,
        };
        let hi = PositionKey {
            z0: 0x1100_0000_0000_0009,
            z1: 0,
        };
        assert_eq!(lo.bucket(), hi.bucket(), "題材が同じ桶に落ちていない");

        // 正しく並べたものは書けるし読める
        let mut buckets: BucketEntries = empty_buckets();
        buckets[lo.bucket() as usize].push((lo, occ));
        buckets[hi.bucket() as usize].push((hi, occ));
        let good = encode(&buckets);
        assert!(decode_all(&good, root).is_ok(), "正しい桶を弾いている");

        // **書く側が桶の取り違えを止める。** 通すと、次の起動で読めずに全件作り直し、
        // 作り直してまた同じものを書く、を繰り返す
        let mut bad: BucketEntries = empty_buckets();
        bad[hi.bucket() as usize + 1].push((hi, occ));
        let mut blob = Vec::new();
        match encode_all(&mut blob, &ctx(), &bad) {
            Ok(()) => panic!("別の桶に置かれた鍵を書いてしまった"),
            Err(e) => assert!(
                e.contains("key belongs to bucket"),
                "別の門番で落ちている: {e}"
            ),
        }

        // **読む側はビット化けが相手。** 書けた blob を壊して確かめる。
        // `zstd` は checksum を書かないので、化けた値がここに届くのは前提
        // （`checked_file_id` の doc）
        // **一致が1件であることを先に確かめる。** 同じ並びが他所にもあると
        // `position` は狙いと別の欄を返し、`is_err()` だけでは気付けない
        let z0_hits = good
            .windows(8)
            .filter(|w| *w == hi.z0.to_le_bytes())
            .count();
        assert_eq!(z0_hits, 1, "鍵の並びが blob に {z0_hits} 箇所ある");
        let z0_at = good
            .windows(8)
            .position(|w| w == hi.z0.to_le_bytes())
            .expect("鍵が blob に載っている");

        let mut swapped = good.clone();
        // 上位バイトを触ると桶が変わる
        swapped[z0_at + 7] ^= 0x01;
        match decode_all(&swapped, root) {
            Ok(_) => panic!("桶からはみ出た鍵を読んでしまった"),
            Err(e) => assert!(
                e.contains("key belongs to bucket"),
                "別の門番で落ちている: {e}"
            ),
        }

        let mut unsorted = good.clone();
        // 下位バイトなら桶は同じまま、並びだけ崩れる
        unsorted[z0_at] = 0x00;
        match decode_all(&unsorted, root) {
            Ok(_) => panic!("並びが崩れた桶を読んでしまった"),
            Err(e) => assert!(e.contains("is not sorted"), "別の門番で落ちている: {e}"),
        }
    }

    /// **出現があるのに節表が無い blob も読まない。**
    ///
    /// なぜ塞ぐかは `decode_all` の同じ検査に書いてある。
    /// この形は壊れている合図。
    ///
    /// **`is_occ_alive` は落とさない** — あれが見るのはファイル表だけ。
    #[test]
    fn occurrences_without_a_node_table_are_neither_written_nor_read() {
        let root = Path::new("/tmp/obs-shogi-no-nt");
        let mut ft = FileTable::default();
        ft.upsert(FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            r#gen: 1,
        });
        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();
        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-no-nt/a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );

        let key = PositionKey {
            z0: 0x5500_0000_0000_0001,
            z1: 0,
        };
        let mut buckets: BucketEntries = empty_buckets();
        buckets[key.bucket() as usize].push((
            key,
            Occurrence {
                file_id: 1,
                r#gen: 1,
                node_id: 0,
            },
        ));

        // 節表を持たせずに書こうとすると、書く側が止める
        let nts = NodeTables::default();
        let mut blob = Vec::new();
        let err = encode_all(
            &mut blob,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 2,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect_err("節表の無い出現を書いてしまった");
        assert!(
            err.contains("has occurrences but no node table"),
            "断った理由が違う: {err}"
        );

        // **読む側も同じ形を断る。** 書く側が止めるので blob は作れないから、
        // 節表を持たせて書いてから、節表の `file_id` を別の値へ壊す。
        // ビット化けで実際に起きる形（表が別の `file_id` に載り、
        // 元の `file_id` が表を失う）
        let mut nt = NodeTable::empty();
        nt.nodes.push(crate::search::store::node_table::NodeCursor {
            tesuu: 0,
            fork_off: 0,
            fork_len: 0,
        });
        let mut with_nt = NodeTables::default();
        with_nt.upsert(1, Arc::new(nt));

        let mut good = Vec::new();
        encode_all(
            &mut good,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 2,
                ft: &ft,
                nts: &with_nt,
            },
            &buckets,
        )
        .expect("書けない");
        assert!(decode_all(&good, root).is_ok(), "正しい blob を弾いている");

        // 節表の欄は file_id(4) + nodes_len(4) + forks_len(4)。
        // **同じ並びが出現レコード（file_id=1 / gen=1 / node_id=0）にも出る。**
        // 節表は桶より前に書かれるので、前の一致を採る
        let nt_head: Vec<u8> = 1u32
            .to_le_bytes()
            .iter()
            .chain(1u32.to_le_bytes().iter())
            .chain(0u32.to_le_bytes().iter())
            .copied()
            .collect();
        let hits = good
            .windows(nt_head.len())
            .filter(|w| *w == nt_head.as_slice())
            .count();
        assert_eq!(hits, 2, "一致の数が想定と違う。位置の採り方を見直すこと");

        let at = good
            .windows(nt_head.len())
            .position(|w| w == nt_head.as_slice())
            .expect("節表の頭が blob に載っている");
        let mut orphan = good.clone();
        orphan[at] = 0; // 表が file_id 0 に載る。file_id 1 は表を失う
        match decode_all(&orphan, root) {
            Err(e) => assert!(
                e.contains("no node table"),
                "断った理由が違う（別の門番を踏んでいる）: {e}"
            ),
            Ok(_) => panic!("節表を失った file_id の出現を読んでしまった"),
        }
    }

    /// **分岐の表の外を指す範囲は書かない。** 読む側と同じ検査を書く側にも置く。
    #[test]
    fn a_fork_range_outside_the_table_is_not_written() {
        use crate::search::store::node_table::NodeCursor;

        let root = Path::new("/tmp/obs-shogi-fork-write");
        let mut ft = FileTable::default();
        ft.upsert(FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            r#gen: 1,
        });

        // 分岐の表は空なのに、節が 0..3 を指す
        let mut nt = NodeTable::empty();
        nt.nodes.push(NodeCursor {
            tesuu: 0,
            fork_off: 0,
            fork_len: 3,
        });
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(nt));

        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();
        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-fork-write/a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );

        let key = PositionKey {
            z0: 0x8800_0000_0000_0001,
            z1: 0,
        };
        let mut buckets: BucketEntries = empty_buckets();
        buckets[key.bucket() as usize].push((
            key,
            Occurrence {
                file_id: 1,
                r#gen: 1,
                node_id: 0,
            },
        ));

        let mut blob = Vec::new();
        let err = encode_all(
            &mut blob,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 2,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect_err("表の外を指す範囲を書いてしまった");
        assert!(
            err.contains("is out of the fork table for file"),
            "断った理由が違う: {err}"
        );
    }

    /// **節表の外を指す `node_id` は書かない。** 読む側と同じ検査を書く側にも置く。
    #[test]
    fn a_node_id_outside_the_table_is_not_written() {
        let root = Path::new("/tmp/obs-shogi-node-write");
        let mut ft = FileTable::default();
        ft.upsert(FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            r#gen: 1,
        });
        let mut nt = NodeTable::empty();
        nt.nodes.push(crate::search::store::node_table::NodeCursor {
            tesuu: 0,
            fork_off: 0,
            fork_len: 0,
        });
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(nt));

        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();
        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-node-write/a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );

        let key = PositionKey {
            z0: 0x7700_0000_0000_0001,
            z1: 0,
        };
        let mut buckets: BucketEntries = empty_buckets();
        buckets[key.bucket() as usize].push((
            key,
            Occurrence {
                file_id: 1,
                r#gen: 1,
                node_id: 5, // 表は1つしか無い
            },
        ));

        let mut blob = Vec::new();
        let err = encode_all(
            &mut blob,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 2,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect_err("範囲外の node_id を書いてしまった");
        assert!(
            err.contains("is out of range for file"),
            "断った理由が違う: {err}"
        );
    }

    /// **並びが崩れた桶は書かない。** 読む側と同じ検査を書く側にも置く。
    ///
    /// 崩れるのは `compact_bucket_entries` の k-way マージで、桶の割り当てより壊れやすい。
    /// 書けてしまうと、次の起動で読めずに全件作り直し、作り直してまた同じものを
    /// 書く、を繰り返す。
    #[test]
    fn an_unsorted_bucket_is_not_written() {
        let root = Path::new("/tmp/obs-shogi-unsorted-write");
        let mut ft = FileTable::default();
        ft.upsert(FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            r#gen: 1,
        });
        let mut nt = NodeTable::empty();
        nt.nodes.push(crate::search::store::node_table::NodeCursor {
            tesuu: 0,
            fork_off: 0,
            fork_len: 0,
        });
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(nt));

        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();
        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-unsorted-write/a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );
        let occ = Occurrence {
            file_id: 1,
            r#gen: 1,
            node_id: 0,
        };

        // 同じ桶へ降順に積む
        let hi = PositionKey {
            z0: 0x6600_0000_0000_0009,
            z1: 0,
        };
        let lo = PositionKey {
            z0: 0x6600_0000_0000_0001,
            z1: 0,
        };
        let mut buckets: BucketEntries = empty_buckets();
        buckets[hi.bucket() as usize].push((hi, occ));
        buckets[hi.bucket() as usize].push((lo, occ));

        let mut blob = Vec::new();
        let err = encode_all(
            &mut blob,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 2,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect_err("並びが崩れた桶を書いてしまった");
        assert!(err.contains("is not sorted"), "断った理由が違う: {err}");
    }

    /// **分岐の表の外を指す `fork_off` / `fork_len` も読まない。**
    ///
    /// `node_id` と**同じ壊れ方**をする（すり替えの実物と理由は
    /// `query_service.rs` の `cursor_lite` の腕）。
    #[test]
    fn a_fork_range_outside_the_table_is_refused() {
        use crate::search::store::node_table::{ForkPtr, NodeCursor};

        let root = Path::new("/tmp/obs-shogi-fork-guard");
        let mut ft = FileTable::default();
        ft.upsert(FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            r#gen: 1,
        });

        // 分岐は2つ。節はその 0..2 を指す
        let mut nt = NodeTable::empty();
        nt.nodes.push(NodeCursor {
            tesuu: 3,
            fork_off: 0,
            fork_len: 2,
        });
        nt.forks.push(ForkPtr {
            te: 1,
            fork_index: 0,
        });
        nt.forks.push(ForkPtr {
            te: 2,
            fork_index: 1,
        });
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(nt));

        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();
        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-fork-guard/a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );

        let key = PositionKey {
            z0: 0x4400_0000_0000_0001,
            z1: 0,
        };
        let mut buckets: BucketEntries = empty_buckets();
        buckets[key.bucket() as usize].push((
            key,
            Occurrence {
                file_id: 1,
                r#gen: 1,
                node_id: 0,
            },
        ));

        let mut good = Vec::new();
        encode_all(
            &mut good,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 2,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect("書けない");
        assert!(
            decode_all(&good, root).is_ok(),
            "正しい fork の範囲を弾いている"
        );

        // 節の欄は tesuu(4) + fork_off(4) + fork_len(2) + pad(2)。
        // `forks_len` も 2 なので、節の並びそのもので位置を決める
        let node_rec: Vec<u8> = 3u32
            .to_le_bytes()
            .iter()
            .chain(0u32.to_le_bytes().iter())
            .chain(2u16.to_le_bytes().iter())
            .chain(0u16.to_le_bytes().iter())
            .copied()
            .collect();
        let hits = good
            .windows(node_rec.len())
            .filter(|w| *w == node_rec.as_slice())
            .count();
        assert_eq!(hits, 1, "節の欄と同じ並びが blob に {hits} 箇所ある");
        let at = good
            .windows(node_rec.len())
            .position(|w| w == node_rec.as_slice())
            .expect("節の欄が blob に載っている");
        let mut broken = good.clone();
        broken[at + 8] = 9; // fork_len を 9 に。表は2つしか無い
        match decode_all(&broken, root) {
            Ok(_) => panic!("分岐の表の外を指す範囲を読んでしまった"),
            Err(e) => assert!(
                e.contains("out of the fork table"),
                "別の門番で落ちている: {e}"
            ),
        }
    }

    /// **節表の外を指す `node_id` は読まない。**
    ///
    /// 通すと `cursor_lite` が `None` を返す。その先の壊れ方は
    /// `query_service.rs` の `cursor_lite` の腕。
    ///
    /// 桶や並びと同じくビット化けが相手なので、書けた blob を壊して確かめる。
    #[test]
    fn a_node_id_outside_the_table_is_refused() {
        use crate::search::store::node_table::NodeCursor;

        let root = Path::new("/tmp/obs-shogi-node-guard");
        let mut ft = FileTable::default();
        ft.upsert(FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            // **1 にしない。** `file_id` / `gen` / `node_id` が揃うと
            // 出現レコードと同じ並びが blob に3箇所でき、下の byte poke が
            // 狙いと別の欄を壊す
            r#gen: 7,
        });

        // 節を2つだけ持つ表
        let mut nt = NodeTable::empty();
        for tesuu in 0..2u32 {
            nt.nodes.push(NodeCursor {
                tesuu,
                fork_off: 0,
                fork_len: 0,
            });
        }
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(nt));

        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();
        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: PathBuf::from("/tmp/obs-shogi-node-guard/a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );

        let key = PositionKey {
            z0: 0x3300_0000_0000_0001,
            z1: 0,
        };
        let mut buckets: BucketEntries = empty_buckets();
        buckets[key.bucket() as usize].push((
            key,
            Occurrence {
                file_id: 1,
                r#gen: 7,
                node_id: 1, // 表の中
            },
        ));

        let mut good = Vec::new();
        encode_all(
            &mut good,
            &EncodeCtx {
                root_dir: root,
                scan: &scan,
                path_to_id: &path_to_id,
                next_file_id: 2,
                ft: &ft,
                nts: &nts,
            },
            &buckets,
        )
        .expect("書けない");
        assert!(
            decode_all(&good, root).is_ok(),
            "正しい node_id を弾いている"
        );

        // **4バイトの `1` は blob に何度も出る。** 出現レコード12バイトごと
        // 狙い、一致が1件であることを確かめてから壊す
        let occ_rec: Vec<u8> = 1u32
            .to_le_bytes()
            .iter()
            .chain(7u32.to_le_bytes().iter())
            .chain(1u32.to_le_bytes().iter())
            .copied()
            .collect();
        let hits = good
            .windows(occ_rec.len())
            .filter(|w| *w == occ_rec.as_slice())
            .count();
        assert_eq!(hits, 1, "出現と同じ並びが blob に {hits} 箇所ある");
        let at = good
            .windows(occ_rec.len())
            .position(|w| w == occ_rec.as_slice())
            .expect("出現が blob に載っている");
        let mut broken = good.clone();
        // 表は2つしか持たないので、9 は外
        broken[at + 8] = 9;
        match decode_all(&broken, root) {
            Ok(_) => panic!("節表の外を指す node_id を読んでしまった"),
            Err(e) => assert!(e.contains("is out of range"), "別の門番で落ちている: {e}"),
        }
    }

    /// **同じ `file_id` の節表が2つある blob は読まない。**
    ///
    /// 通すと `NodeTables::upsert` が黙って上書きし、**上書きされた側の全ヒットが
    /// 別の棋譜の `tesuu` / `fork_path` を持つ。** 出現側の `node_id` 検査は
    /// 節数が足りていれば通るので、`decode_all` はどこでも `Err` を返さない。
    ///
    /// `node_id` の化けは0手目に落ちるので気付けるが、**こちらはそれらしい局面が出る。**
    ///
    /// 書く側は `by_id_iter().enumerate()` で書くので重複を作れない。**読む側だけ。**
    #[test]
    fn a_node_table_that_is_not_after_the_previous_one_is_refused() {
        use crate::search::store::node_table::NodeTableBuilder;
        use crate::search::types::ForkPointer;

        let root = Path::new("/tmp/obs-shogi-nt-dup");
        let mut ft = FileTable::default();
        for (id, path) in [(1u32, "a.kif"), (2u32, "b.kif"), (3u32, "c.kif")] {
            ft.upsert(FileEntry {
                file_id: id,
                path: path.to_owned(),
                deleted: false,
                indexed: true,
                r#gen: 1,
            });
        }

        // file 1〜3 に、長さの違う節表を持たせる
        let mut nts = NodeTables::default();
        for (id, nodes) in [(1u32, 2usize), (2u32, 3usize), (3u32, 4usize)] {
            let mut b = NodeTableBuilder::new();
            for n in 0..nodes {
                b.push_node(
                    n as u32,
                    &[ForkPointer {
                        te: n as u32,
                        fork_index: 0,
                    }],
                );
            }
            nts.upsert(id, Arc::new(b.finish()));
        }

        let path_to_id: HashMap<String, FileId> = [
            ("a.kif".to_owned(), 1u32),
            ("b.kif".to_owned(), 2u32),
            ("c.kif".to_owned(), 3u32),
        ]
        .into_iter()
        .collect();
        let scan = snapshot_from_records(
            root,
            vec![
                FileRecord {
                    path: PathBuf::from("/tmp/obs-shogi-nt-dup/a.kif"),
                    kind: KifuKind::Kif,
                    size: 10,
                    mtime_ms: 1,
                },
                FileRecord {
                    path: PathBuf::from("/tmp/obs-shogi-nt-dup/b.kif"),
                    kind: KifuKind::Kif,
                    size: 10,
                    mtime_ms: 1,
                },
                FileRecord {
                    path: PathBuf::from("/tmp/obs-shogi-nt-dup/c.kif"),
                    kind: KifuKind::Kif,
                    size: 10,
                    mtime_ms: 1,
                },
            ],
        );

        // 出現は file 1 に1件だけ。**節表の段は桶の段より先に読み切る**ので、
        // 出現の有無はこの門番に届かない。file 3 に置かないのは題材を小さく保つため
        let key = PositionKey {
            z0: 0x7700_0000_0000_0001,
            z1: 0,
        };
        let mut buckets: BucketEntries = empty_buckets();
        buckets[key.bucket() as usize].push((
            key,
            Occurrence {
                file_id: 1,
                r#gen: 1,
                node_id: 1,
            },
        ));

        let ctx = EncodeCtx {
            root_dir: root,
            scan: &scan,
            path_to_id: &path_to_id,
            next_file_id: 4,
            ft: &ft,
            nts: &nts,
        };
        let mut good = Vec::new();
        encode_all(&mut good, &ctx, &buckets).expect("書けない");
        assert!(decode_all(&good, root).is_ok(), "正しい blob を弾いている");

        // **3つ目の節表**の頭（`file_id=3` / `nodes=4` / `forks=4`）を狙う。
        //
        // 直前（file 2）ではなく**その前**（file 1）と重なる形にする。
        // 2つしか無い題材だと `prev == file_id` の腕しか通らず、門番を
        // `file_id == p` に緩める変異が生き残る。そのとき素通りするのは
        // 上のコメントと `search.md` が挙げている題材そのもの（`7 → 5`）
        let head: Vec<u8> = 3u32
            .to_le_bytes()
            .iter()
            .chain(4u32.to_le_bytes().iter())
            .chain(4u32.to_le_bytes().iter())
            .copied()
            .collect();
        let hits = good
            .windows(head.len())
            .filter(|w| *w == head.as_slice())
            .count();
        assert_eq!(hits, 1, "節表の頭と同じ並びが blob に {hits} 箇所ある");
        let at = good
            .windows(head.len())
            .position(|w| w == head.as_slice())
            .expect("節表の頭が blob に載っている");

        // **腕を2つとも通す。** `<=` の片側しか通らない題材だと、
        // もう片方に緩める変異が生き残る
        for (to, what) in [
            // 3 → 1。**直前ではない前**の節表と重なる（`<` の腕）。
            // `search.md` が挙げている `7 → 5` がこの形
            (1u8, "前の節表を上書きする file_id"),
            // 3 → 2。直前と同じ（`==` の腕）
            (2u8, "直前と同じ file_id"),
        ] {
            let mut broken = good.clone();
            broken[at] = to;
            match decode_all(&broken, root) {
                Ok(_) => panic!("{what}を読んでしまった"),
                Err(e) => assert!(e.contains("is not after"), "別の門番で落ちている: {e}"),
            }
        }
    }
    /// 保存・復元を通すための小さな索引。
    ///
    /// 1ファイル・1局面。**形式の検査は他のテストが見る**ので、
    /// ここは「置いて読める」ことだけを試せれば足りる。
    fn a_small_index(
        root: &Path,
    ) -> (IndexSnapshot, ScanSnapshot, HashMap<String, FileId>, FileId) {
        use crate::search::store::bucket::bucketize_entries;
        use crate::search::store::node_table::NodeTableBuilder;
        use crate::search::store::snapshot::IndexState;

        let entry = FileEntry {
            file_id: 1,
            path: "a.kif".to_owned(),
            deleted: false,
            indexed: true,
            r#gen: 1,
        };
        let mut ft = FileTable::default();
        ft.upsert(entry.clone());

        let mut b = NodeTableBuilder::new();
        b.push_node(0, &[]);
        let mut nts = NodeTables::default();
        nts.upsert(1, Arc::new(b.finish()));

        let key = PositionKey {
            z0: 0x1100_0000_0000_0001,
            z1: 0x2222,
        };
        let by_bucket = bucketize_entries(vec![(
            key,
            Occurrence {
                file_id: 1,
                r#gen: 1,
                node_id: 0,
            },
        )]);

        let snap = IndexSnapshot::default()
            .with_state(IndexState::Ready)
            .with_files(vec![(entry, nts.get(1).expect("節表").clone(), by_bucket)]);

        let scan = snapshot_from_records(
            root,
            vec![FileRecord {
                path: root.join("a.kif"),
                kind: KifuKind::Kif,
                size: 10,
                mtime_ms: 1,
            }],
        );
        let path_to_id: HashMap<String, FileId> =
            [("a.kif".to_owned(), 1u32)].into_iter().collect();

        (snap, scan, path_to_id, 2)
    }

    /// **置いて読み戻すと、同じ索引が返る。**
    ///
    /// これまで `save_checkpoint` / `try_restore` を通るテストは1本も無かった。
    /// `AppHandle` を直に取っていて、置き場を差し替えられなかったため。
    #[test]
    fn a_checkpoint_can_be_written_and_read_back() {
        use crate::storage::InMemory;

        let root = Path::new("/tmp/obs-shogi-roundtrip");
        let (snap, scan, path_to_id, next) = a_small_index(root);
        let store = InMemory::new();

        save_checkpoint(&store, root, &snap, &scan, &path_to_id, next).expect("置けない");
        let back = try_restore(&store, root).expect("読み戻せない");

        // **索引の中身が戻ること。** スカラだけ見ると、桶の書き出しを潰す変異が
        // 緑のまま通る（`Codec` の doc が約束する「往復すること」の実体はここ）
        let key = PositionKey {
            z0: 0x1100_0000_0000_0001,
            z1: 0x2222,
        };
        let restored_snap = IndexSnapshot::default().with_files(vec![(
            back.index
                .file_table
                .get(1)
                .expect("ファイル表に file 1 が無い"),
            back.index
                .node_tables
                .get(1)
                .expect("節表に file 1 が無い")
                .clone(),
            back.index.buckets,
        )]);
        let hits = restored_snap.search_occurrences_by_key(key);
        assert_eq!(hits.len(), 1, "読み戻した索引でヒットしない");
        assert_eq!(hits[0].file_id, 1);
        assert_eq!(hits[0].node_id, 0);

        assert_eq!(back.scan.next_file_id, next);
        assert_eq!(
            back.scan.path_to_id.get("a.kif"),
            Some(&1u32),
            "path_to_id が戻っていない"
        );
        assert_eq!(
            back.scan.snapshot.by_path.len(),
            1,
            "走査の記録が戻っていない"
        );
    }

    /// **置いていなければ復元は失敗する。** 初回起動がこの形。
    #[test]
    fn restoring_without_a_checkpoint_fails() {
        use crate::storage::InMemory;

        let store = InMemory::new();
        assert!(try_restore(&store, Path::new("/tmp/obs-shogi-none")).is_err());
    }

    /// **置き場が落ちたら、置くのも落ちる。**
    ///
    /// ディスクの失敗はテストから起こせないので、仕込める置き場で踏む。
    /// **呼び手は `Err` を捨てる**ので、ここが黙ると次の起動が毎回全件構築になる。
    #[test]
    fn a_failing_store_makes_the_checkpoint_fail() {
        use crate::storage::InMemory;

        let root = Path::new("/tmp/obs-shogi-failing");
        let (snap, scan, path_to_id, next) = a_small_index(root);

        let err = save_checkpoint(&InMemory::failing(), root, &snap, &scan, &path_to_id, next)
            .expect_err("落ちるはずが通った");
        assert!(err.contains("仕込んだ失敗"), "別の理由で落ちている: {err}");
    }

    /// **別のプロジェクトのキャッシュは掴まない。**
    ///
    /// 守りは2枚ある。名前がプロジェクトごとに違うことと、blob の中に書いた
    /// root hash を読み戻しで突き合わせること。
    ///
    /// **名前の側を殺しても中身の側が止めること**を見る —— 名前を殺した
    /// 変異が生き残らないよう、同じ `key` に置いてから別の根で読む。
    #[test]
    fn a_checkpoint_of_another_project_is_refused_even_under_the_same_key() {
        use crate::storage::{BlobStore, InMemory};

        let mine = Path::new("/tmp/obs-shogi-mine");
        let theirs = Path::new("/tmp/obs-shogi-theirs");
        let (snap, scan, path_to_id, next) = a_small_index(mine);
        let store = InMemory::new();

        save_checkpoint(&store, mine, &snap, &scan, &path_to_id, next).expect("置けない");

        // 名前の守りを外す —— 相手の名前にも同じ blob を置く
        let blob = store.load(&cache_key(mine)).expect("置いたものが無い");
        store.save(&cache_key(theirs), &blob).expect("置けない");

        let err = match try_restore(&store, theirs) {
            Ok(_) => panic!("別のプロジェクトのものを読んでいる"),
            Err(e) => e,
        };
        assert!(
            err.contains("root hash mismatch"),
            "別の理由で落ちている: {err}"
        );
    }
}
