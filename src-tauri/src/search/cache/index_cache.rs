use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::{AppHandle, Manager};

use crate::search::position::position_key::PositionKey;
use crate::search::read::fs_scan::{snapshot_from_records, FileRecord, KifuKind, ScanSnapshot};
use crate::search::store::bucket::BucketEntries;
use crate::search::store::file_table::FileTable;
use crate::search::store::index_store::{IndexSnapshot, NodeTables};
use crate::search::store::node_table::NodeTable;
use crate::search::store::segment::SegmentArc;
use crate::search::types::{FileEntry, FileId, Occurrence};

macro_rules! trace {
    ($($t:tt)*) => {
        log::debug!("[index_cache] {}", format_args!($($t)*));
    };
}

const MAGIC: [u8; 8] = *b"OBSIXv01";

/// 索引の中身の版。**容れ物の形だけでなく、棋譜の読み方が変わったときも上げる。**
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
const VERSION: u32 = 3;

pub struct RestoredCache {
    pub file_table: FileTable,
    pub node_tables: NodeTables,
    pub buckets: BucketEntries, // compacted
    pub scan: ScanSnapshot,
    pub path_to_id: HashMap<String, FileId>,
    pub next_file_id: FileId,
}

struct EncodeCtx<'a> {
    root_dir: &'a Path,
    scan: &'a ScanSnapshot,
    path_to_id: &'a HashMap<String, FileId>,
    next_file_id: FileId,
    ft: &'a FileTable,
    nts: &'a NodeTables,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn root_hash(root_dir: &Path) -> [u8; 32] {
    let s = root_dir.to_string_lossy();
    blake3::hash(s.as_bytes()).into()
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // app_cache_dir を使う（派生キャッシュなので）
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("obs-shogi")
        .join("index");
    Ok(dir)
}

fn cache_paths(app: &AppHandle, root_dir: &Path) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let dir = cache_dir(app)?;
    let h = root_hash(root_dir);
    let hex = hex32(&h);
    let proj = dir.join(hex);
    let final_path = proj.join("index.v1.zst");
    let bak_path = proj.join("index.v1.bak");
    Ok((proj, final_path, bak_path))
}

fn hex32(h: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(64);
    for b in h {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

// --------------------
// public APIs
// --------------------

pub fn save_checkpoint(
    app: &AppHandle,
    root_dir: &Path,
    snap: &IndexSnapshot,
    scan: &ScanSnapshot,
    path_to_id: &HashMap<String, FileId>,
    next_file_id: FileId,
) -> Result<(), String> {
    let (proj_dir, final_path, bak_path) = cache_paths(app, root_dir)?;
    trace!("save_checkpoint BEGIN root_dir={}", root_dir.display());
    trace!(
        "paths proj_dir={} final={} bak={}",
        proj_dir.display(),
        final_path.display(),
        bak_path.display()
    );

    fs::create_dir_all(&proj_dir).map_err(|e| {
        trace!("create_dir_all FAILED: {e}");
        e.to_string()
    })?;
    trace!("create_dir_all OK");

    trace!("compact_all_buckets...");
    // 1) コンパクション（bucketごとに1本化）
    let buckets = compact_all_buckets(snap);
    trace!("compact_all_buckets OK");

    trace!("encode_all...");
    // 2) エンコード（非圧縮 body）
    let mut body = Vec::<u8>::new();

    let ctx = EncodeCtx {
        root_dir,
        scan,
        path_to_id,
        next_file_id,
        ft: snap.file_table.as_ref(),
        nts: snap.node_tables.as_ref(),
    };

    encode_all(&mut body, &ctx, &buckets).map_err(|e| {
        trace!("encode_all FAILED: {e}");
        e
    })?;

    trace!("encode_all OK body_bytes={}", body.len());

    trace!("zstd compress...");
    // 3) zstd 圧縮して tmp に書く → atomic-ish に置き換え
    let tmp_path = final_path.with_extension("zst.tmp");
    trace!("write tmp {}", tmp_path.display());

    {
        let mut out = fs::File::create(&tmp_path).map_err(|e| {
            trace!("create tmp FAILED: {e}");
            e.to_string()
        })?;
        // zstd level=1 (速い)
        let compressed = zstd::stream::encode_all(body.as_slice(), 1).map_err(|e| e.to_string())?;
        out.write_all(&compressed).map_err(|e| {
            trace!("write_all FAILED: {e}");
            e.to_string()
        })?;
        out.flush().map_err(|e| {
            trace!("flush FAILED: {e}");
            e.to_string()
        })?;
    }
    trace!("tmp write OK");

    // Windows 対策：final があれば bak に退避してから rename
    if final_path.exists() {
        trace!("final exists → move to bak");
        let _ = fs::remove_file(&bak_path);
        fs::rename(&final_path, &bak_path).map_err(|e| {
            trace!("rename final->bak FAILED: {e}");
            e.to_string()
        })?;
        trace!("rename final->bak OK");
    }
    trace!("rename tmp->final");
    fs::rename(&tmp_path, &final_path).map_err(|e| {
        trace!("rename tmp->final FAILED: {e}");
        e.to_string()
    })?;
    trace!("rename tmp->final OK");
    let _ = fs::remove_file(&bak_path);
    trace!("save_checkpoint END OK");

    Ok(())
}

pub fn try_restore(app: &AppHandle, root_dir: &Path) -> Result<RestoredCache, String> {
    let (_proj_dir, final_path, bak_path) = cache_paths(app, root_dir)?;
    trace!("try_restore BEGIN root_dir={}", root_dir.display());
    trace!(
        "final={} exists={}",
        final_path.display(),
        final_path.exists()
    );
    trace!("bak  ={} exists={}", bak_path.display(), bak_path.exists());

    // final → 失敗したら bak
    match read_decode(&final_path, root_dir) {
        Ok(v) => {
            trace!("try_restore OK (final)");
            Ok(v)
        }
        Err(e_final) => {
            trace!("try_restore FAILED (final): {e_final}");
            if bak_path.exists() {
                match read_decode(&bak_path, root_dir) {
                    Ok(v) => {
                        trace!("try_restore OK (bak)");
                        Ok(v)
                    }
                    Err(e_bak) => {
                        trace!("try_restore FAILED (bak): {e_bak}");
                        Err(format!("restore failed. final: {e_final} / bak: {e_bak}"))
                    }
                }
            } else {
                Err(format!("restore failed. final: {e_final} (bak not found)"))
            }
        }
    }
}

fn read_decode(path: &Path, root_dir: &Path) -> Result<RestoredCache, String> {
    trace!("read_decode path={}", path.display());
    let bytes = fs::read(path).map_err(|e| {
        let msg = format!("read failed {}: {e}", path.display());
        trace!("{msg}");
        msg
    })?;
    let decompressed = zstd::stream::decode_all(bytes.as_slice()).map_err(|e| {
        let msg = format!("zstd decode: {e}");
        trace!("{msg}");
        msg
    })?;
    trace!("zstd decode OK bytes={}", decompressed.len());
    decode_all(&decompressed, root_dir).map_err(|e| {
        trace!("decode_all FAILED: {e}");
        e
    })
}

// --------------------
// compaction
// --------------------

fn compact_all_buckets(snap: &IndexSnapshot) -> BucketEntries {
    std::array::from_fn(|b| compact_bucket(b, &snap.buckets[b], snap.file_table.as_ref()))
}

#[derive(Clone, Copy)]
struct HeapItem {
    key: PositionKey,
    occ: Occurrence,
    seg: usize,
    idx: usize,
}

impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        // min-heap にしたいので reverse
        // tie-break も固定（決定性）
        (
            other.key.z0,
            other.key.z1,
            other.occ.file_id,
            other.occ.node_id,
        )
            .cmp(&(self.key.z0, self.key.z1, self.occ.file_id, self.occ.node_id))
    }
}
impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for HeapItem {
    fn eq(&self, other: &Self) -> bool {
        self.key.z0 == other.key.z0
            && self.key.z1 == other.key.z1
            && self.occ.file_id == other.occ.file_id
            && self.occ.node_id == other.occ.node_id
    }
}
impl Eq for HeapItem {}

fn compact_bucket(
    bucket_idx: usize,
    segs: &[SegmentArc],
    ft: &FileTable,
) -> Vec<(PositionKey, Occurrence)> {
    if segs.is_empty() {
        return Vec::new();
    }

    let mut heap = BinaryHeap::<HeapItem>::new();

    for (si, seg) in segs.iter().enumerate() {
        if seg.is_empty() {
            continue;
        }
        let key = seg.key_at(0);
        let occ = seg.occ_at(0);
        heap.push(HeapItem {
            key,
            occ,
            seg: si,
            idx: 0,
        });
    }

    let mut out: Vec<(PositionKey, Occurrence)> = Vec::new();

    while let Some(item) = heap.pop() {
        if ft.is_occ_alive(item.occ.file_id, item.occ.r#gen) {
            out.push((item.key, item.occ));
        }

        let next_i = item.idx + 1;
        let seg = &segs[item.seg];
        if next_i < seg.len() {
            let key = seg.key_at(next_i);
            let occ = seg.occ_at(next_i);
            heap.push(HeapItem {
                key,
                occ,
                seg: item.seg,
                idx: next_i,
            });
        }
    }

    let _ = bucket_idx;
    out
}

// --------------------
// binary encode/decode
// --------------------
fn encode_all(w: &mut Vec<u8>, ctx: &EncodeCtx<'_>, buckets: &BucketEntries) -> Result<(), String> {
    w.extend_from_slice(&MAGIC);
    write_u32(w, VERSION);
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
    for v in buckets.iter() {
        write_u32(w, v.len() as u32);
        for (k, occ) in v {
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
/// 呼び手（`api.rs` の `open_project`）は `Err` なら全件作り直しへ落ちられるが、
/// 落ちたプロセスは何も選べない。
///
/// 上限に `ft_len` を使えるのは、`file_id` が1から詰めて振られ、
/// 生きている `file_id` は必ずファイル表に項目を持つから
/// （`FileTable::iter_all` は空のスロットを飛ばすので、項目数＝最大の `file_id`）。
/// その `ft_len` 自身は [`Reader::read_len`] が残りバイト数で縛るので、
/// **確保量は blob の長さで頭打ちになる**。
/// 万一 `file_id` が疎になる変更が入っても、外れる方向は「捨てて作り直す」側。
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
    /// `file_id` + `gen` + `deleted` + パスの長さ
    pub(super) const FILE_ENTRY: usize = 4 + 4 + 1 + 4;
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

fn decode_all(bytes: &[u8], root_dir: &Path) -> Result<RestoredCache, String> {
    let mut r = Reader::new(bytes);

    let magic = r.read_fixed::<8>()?;
    if magic != MAGIC {
        return Err("bad magic".to_string());
    }

    let ver = r.read_u32()?;
    if ver != VERSION {
        return Err(format!("bad version: {ver}"));
    }

    let _created_ms = r.read_u64()?;

    // ここは Vec<u8> じゃなく固定長で読む方が楽（今のままでもOK）
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
        let path = r.read_string()?;
        ft.upsert(FileEntry {
            file_id,
            r#gen: gen_val,
            deleted,
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
    for _ in 0..nt_len {
        let file_id = checked_file_id(r.read_u32()?, ft_len)?;
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
    let mut buckets: BucketEntries = std::array::from_fn(|_| Vec::new());
    for bucket in buckets.iter_mut() {
        let n = r.read_len(min_bytes::OCCURRENCE)?;
        let mut v = Vec::with_capacity(n);
        for _ in 0..n {
            let z0 = r.read_u64()?;
            let z1 = r.read_u64()?;
            let file_id = checked_file_id(r.read_u32()?, ft_len)?;
            let gen_val = r.read_u32()?;
            let node_id = r.read_u32()?;
            v.push((
                PositionKey { z0, z1 },
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

    log::info!(
    "[index_cache] restored stats: file_table_len={} node_tables_some={} scan_paths={} path_to_id_len={} next_file_id={} bucket_entries_total={}",
    ft.len(),
    nt_some,
    scan.by_path.len(),
    path_to_id.len(),
    next_file_id,
    total_bucket_entries,
);

    Ok(RestoredCache {
        file_table: ft,
        node_tables: nts,
        buckets,
        scan,
        path_to_id,
        next_file_id,
    })
}

// --------------------
// helpers
// --------------------

fn kind_to_u8(k: KifuKind) -> u8 {
    match k {
        KifuKind::Kif => 1,
        KifuKind::Ki2 => 2,
        KifuKind::Csa => 3,
        KifuKind::Jkf => 4,
    }
}
fn u8_to_kind(v: u8) -> Result<KifuKind, String> {
    Ok(match v {
        1 => KifuKind::Kif,
        2 => KifuKind::Ki2,
        3 => KifuKind::Csa,
        4 => KifuKind::Jkf,
        _ => return Err(format!("bad kind: {v}")),
    })
}

// FileTable から全エントリを列挙したいので helper を FileTable に追加する（Step5参照）

fn write_u8(w: &mut Vec<u8>, v: u8) {
    w.push(v);
}
fn write_u16(w: &mut Vec<u8>, v: u16) {
    w.extend_from_slice(&v.to_le_bytes());
}
fn write_u32(w: &mut Vec<u8>, v: u32) {
    w.extend_from_slice(&v.to_le_bytes());
}
fn write_u64(w: &mut Vec<u8>, v: u64) {
    w.extend_from_slice(&v.to_le_bytes());
}

fn write_string(w: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    write_u32(w, b.len() as u32);
    w.extend_from_slice(b);
}

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}
impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Self { b, i: 0 }
    }
    fn read_u8(&mut self) -> Result<u8, String> {
        if self.i + 1 > self.b.len() {
            return Err("unexpected eof".to_string());
        }
        let v = self.b[self.i];
        self.i += 1;
        Ok(v)
    }
    fn read_u16(&mut self) -> Result<u16, String> {
        let a = self.read_fixed::<2>()?;
        Ok(u16::from_le_bytes(a))
    }
    fn read_u32(&mut self) -> Result<u32, String> {
        let a = self.read_fixed::<4>()?;
        Ok(u32::from_le_bytes(a))
    }
    fn read_u64(&mut self) -> Result<u64, String> {
        let a = self.read_fixed::<8>()?;
        Ok(u64::from_le_bytes(a))
    }
    fn read_string(&mut self) -> Result<String, String> {
        let n = self.read_u32()? as usize;
        if self.i + n > self.b.len() {
            return Err("unexpected eof".to_string());
        }
        let s = std::str::from_utf8(&self.b[self.i..self.i + n]).map_err(|e| e.to_string())?;
        self.i += n;
        Ok(s.to_string())
    }
    /// 項目数を読む。**残っているバイト数で縛る。**
    ///
    /// キャッシュから読んだ `u32` をそのまま `with_capacity` / `reserve` /
    /// `resize` に渡すと、**壊れた4バイトが確保量を決める**。
    /// とくに `HashMap::with_capacity` は hashbrown が制御バイトを埋めるので
    /// 遅延予約にならず、実際にページを触る — 68バイトの blob で
    /// `map_len = 5e8` にすると 1.08 GB / 353 ms を実測している。
    /// `u32::MAX` まで振れば `handle_alloc_error` が unwind せずプロセスが落ちる。
    ///
    /// 実プロジェクトの項目数は小さいので、**最上位ビットが1つ反転するだけで
    /// 20億を超える**。`zstd` は checksum 無しなので化けた値はここに届く（#336）。
    ///
    /// `min_bytes_each` は [`min_bytes`] から選ぶ。n 項目を読むには
    /// 少なくとも `n * min_bytes_each` バイト残っている必要があり、
    /// **これで確保量が blob の長さで頭打ちになる**。
    fn read_len(&mut self, min_bytes_each: usize) -> Result<usize, String> {
        let n = self.read_u32()? as usize;
        let remaining = self.b.len() - self.i;
        if n.saturating_mul(min_bytes_each) > remaining {
            return Err(format!("bad length: {n} (remaining {remaining} bytes)"));
        }
        Ok(n)
    }

    fn read_fixed<const N: usize>(&mut self) -> Result<[u8; N], String> {
        if self.i + N > self.b.len() {
            return Err("unexpected eof".to_string());
        }
        let mut out = [0u8; N];
        out.copy_from_slice(&self.b[self.i..self.i + N]);
        self.i += N;
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前の版で書かれた索引は読まない。
    ///
    /// 読んでしまうと、棋譜の解釈が変わったあとも古い索引が残る。
    /// `try_restore` が `Err` を返すと呼び手（`api.rs` の `open_project`）は
    /// 全件の作り直しへ落ちるので、捨てて損はない。
    #[test]
    fn an_index_written_by_an_older_version_is_rejected() {
        let mut blob = Vec::new();
        blob.extend_from_slice(&MAGIC);
        write_u32(&mut blob, VERSION - 1);

        // RestoredCache は Debug を実装していないので expect_err は使えない
        let Err(err) = decode_all(&blob, Path::new("/tmp")) else {
            panic!("前の版の索引を読んでしまった");
        };
        assert!(err.contains("bad version"), "理由が版でない: {err}");
    }

    /// 今の版で書いたものは、版の検査を通り抜ける。
    ///
    /// 上のテストだけだと、`VERSION` をいくつにしても通る。
    #[test]
    fn the_current_version_passes_the_version_check() {
        let mut blob = Vec::new();
        blob.extend_from_slice(&MAGIC);
        write_u32(&mut blob, VERSION);

        let Err(err) = decode_all(&blob, Path::new("/tmp")) else {
            panic!("本体が無いので失敗するはず");
        };
        assert!(!err.contains("bad version"), "今の版が弾かれている: {err}");
    }

    /// 退役した版の最大値。**[`VERSION`] のすぐ下の値をリテラルで持つ。**
    ///
    /// この2つの関係は下の `const _` がコンパイル時に見ているので、
    /// **どちらかだけを動かすと `cargo test` / `cargo clippy --all-targets` が落ちる**
    /// （`const _` が `#[cfg(test)]` の中にあるので、`cargo build` だけでは通る）。
    /// 留めているのは言語ではなく、Rust を触ったら `verify:rust` を必ず走らせる
    /// `verify-gate.sh` のほう。
    const LATEST_RETIRED_VERSION: u32 = 2;

    /// 過ぎた版の索引を、二度と受け入れない。
    ///
    /// `the_current_version_passes_the_version_check` と
    /// `a_file_that_is_not_an_index_is_rejected` は `VERSION` そのものを使って
    /// blob を組むので、値がいくつでも通る。**[`VERSION`] を留めるものが他に無い。**
    /// 前の版に戻ると、その版が書いた索引がそのまま読まれ、
    /// `(size, mtime_ms)` が変わっていない棋譜は古い解釈のまま検索に当たり続ける。
    /// 警告も出ない。
    #[test]
    fn superseded_versions_are_never_accepted_again() {
        // **等号で留める。** 不等号（`VERSION > LATEST_RETIRED_VERSION`）だと
        // 下げたときしか落ちない — 版を上げて `LATEST_RETIRED_VERSION` を
        // 据え置くと、間の版を一度も試さないまま緑で通る。
        // 実行時の `assert!` は定数なので clippy が断る。コンパイル時に見る
        const _: () = assert!(
            VERSION == LATEST_RETIRED_VERSION + 1,
            "`VERSION` と `LATEST_RETIRED_VERSION` は一緒に動かすこと"
        );

        for old in 1..=LATEST_RETIRED_VERSION {
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
    fn a_file_that_is_not_an_index_is_rejected() {
        let mut blob = b"PK\x03\x04....".to_vec();
        write_u32(&mut blob, VERSION);

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
    fn an_index_built_for_another_project_is_rejected() {
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
        write_u32(&mut blob, VERSION);
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
                    write_u32(b, 0); // node_tables: 0件
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
        use crate::search::store::node_table::{ForkPtr, NodeCursor};

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
                r#gen: 1,
            });
            path_to_id.insert(path_of(i), i);
            records.push(FileRecord {
                path: root.join(path_of(i)),
                kind: KifuKind::Kif,
                size: 4096,
                mtime_ms: 1_700_000_000_000,
            });

            let mut nt = NodeTable::empty();
            for n in 0..NODES_PER_FILE {
                nt.nodes.push(NodeCursor {
                    tesuu: n,
                    fork_off: n % 3,
                    fork_len: (n % 2) as u16,
                });
            }
            for f in 0..3u32 {
                nt.forks.push(ForkPtr {
                    te: f,
                    fork_index: f,
                });
            }
            nts.upsert(i, Arc::new(nt));
        }

        let mut buckets: BucketEntries = std::array::from_fn(|_| Vec::new());
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
        assert_eq!(back.file_table.len(), FILES as usize);
        assert_eq!(back.scan.by_path.len(), FILES as usize);
        assert_eq!(back.path_to_id.len(), FILES as usize);
        assert_eq!(
            back.buckets.iter().map(Vec::len).sum::<usize>(),
            written,
            "出現が欠けた"
        );
        assert_eq!(
            back.node_tables
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
    /// 検索は当たるのに指し手が別の棋譜のものになる。
    /// ヘッダ12バイトで止まるテストでは、そこまで届かない。
    ///
    /// **`VERSION` を上げた版に更新した利用者は、次の起動で必ず1回ここを通る。**
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

        // 別々の bucket に落ちる鍵を選ぶ（bucket は z0 の下位8ビットで決まる）
        let mut buckets: BucketEntries = std::array::from_fn(|_| Vec::new());
        buckets[0x11].push((
            PositionKey {
                z0: 0x1111,
                z1: 0x2222,
            },
            Occurrence {
                file_id: 1,
                r#gen: 41,
                node_id: 0,
            },
        ));
        buckets[0x22].push((
            PositionKey {
                z0: 0x2222,
                z1: 0x3333,
            },
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

        assert_eq!(back.next_file_id, 3);
        assert_eq!(back.path_to_id, path_to_id);

        for file_id in [1u32, 2] {
            let before = ft.get(file_id).expect("元のファイル表に無い");
            let after = back.file_table.get(file_id).expect("読み戻せていない");
            assert_eq!(
                (after.path, after.deleted, after.r#gen),
                (before.path, before.deleted, before.r#gen),
                "file_id={file_id}"
            );
        }

        for (key, rec) in &scan.by_path {
            let after = back.scan.by_path.get(key).expect("走査結果が欠けた");
            assert_eq!(
                (after.kind, after.size, after.mtime_ms),
                (rec.kind, rec.size, rec.mtime_ms),
                "{:?}",
                rec.path
            );
        }

        let after_nt = back.node_tables.get(1).expect("ノード表が欠けた");
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
        assert_eq!(flat(&back.buckets), flat(&buckets));
    }
}
