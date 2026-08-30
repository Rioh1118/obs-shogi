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

use super::{
    file_table::FileTable,
    fs_scan::{snapshot_from_records, FileRecord, KifuKind, ScanSnapshot},
    index_store::{IndexSnapshot, NodeTables},
    node_table::NodeTable,
    position_key::PositionKey,
    segment::SegmentArc,
    types::{FileEntry, FileId, Occurrence},
};

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
const VERSION: u32 = 2;

pub struct RestoredCache {
    pub file_table: FileTable,
    pub node_tables: NodeTables,
    pub buckets: [Vec<(PositionKey, Occurrence)>; 256], // compacted
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

fn compact_all_buckets(snap: &IndexSnapshot) -> [Vec<(PositionKey, Occurrence)>; 256] {
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
fn encode_all(
    w: &mut Vec<u8>,
    ctx: &EncodeCtx<'_>,
    buckets: &[Vec<(PositionKey, Occurrence)>; 256],
) -> Result<(), String> {
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
/// **確保量が入力の長さで頭打ちになる**のがここで欲しい性質で、
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
    let ft_len = r.read_u32()? as usize;
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
    let rec_len = r.read_u32()? as usize;
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
    let map_len = r.read_u32()? as usize;
    let mut path_to_id = HashMap::with_capacity(map_len);
    for _ in 0..map_len {
        let p = r.read_string()?;
        let id = checked_file_id(r.read_u32()?, ft_len)?;
        path_to_id.insert(p, id);
    }

    // ---- node tables ----
    let nt_len = r.read_u32()? as usize;
    let mut nts = NodeTables::default();
    for _ in 0..nt_len {
        let file_id = checked_file_id(r.read_u32()?, ft_len)?;
        let nodes_len = r.read_u32()? as usize;
        let forks_len = r.read_u32()? as usize;

        let mut nt = NodeTable::empty();
        nt.nodes.reserve(nodes_len);
        nt.forks.reserve(forks_len);

        for _ in 0..nodes_len {
            let tesuu = r.read_u32()?;
            let fork_off = r.read_u32()?;
            let fork_len = r.read_u16()?;
            let _pad = r.read_u16()?;
            nt.nodes.push(super::node_table::NodeCursor {
                tesuu,
                fork_off,
                fork_len,
            });
        }
        for _ in 0..forks_len {
            let te = r.read_u32()?;
            let fork_index = r.read_u32()?;
            nt.forks.push(super::node_table::ForkPtr { te, fork_index });
        }

        nts.upsert(file_id, Arc::new(nt));
    }

    // ---- buckets ----
    let mut buckets: [Vec<(PositionKey, Occurrence)>; 256] = std::array::from_fn(|_| Vec::new());
    for bucket in buckets.iter_mut() {
        let n = r.read_u32()? as usize;
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

    /// ディスクに書く版の値を**リテラルで**留める。
    ///
    /// 上の2本は `VERSION` そのものを使って blob を組むので、値がいくつでも通る。
    /// **[`VERSION`] を留めるものが他に無い。** 1 に戻ると v0.3.1 が書いた索引が
    /// そのまま読まれ、`(size, mtime_ms)` が変わっていない棋譜は
    /// 古い解釈のまま検索に当たり続ける。警告も出ない。
    #[test]
    fn version_one_is_never_accepted_again() {
        let blob = [b'O', b'B', b'S', b'I', b'X', b'v', b'0', b'1', 1, 0, 0, 0];

        let Err(err) = decode_all(&blob, Path::new("/tmp")) else {
            panic!("v0.3.1 が書いた索引を読んでしまった");
        };
        assert!(err.contains("bad version"), "理由が版でない: {err}");
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
        use super::super::node_table::{ForkPtr, NodeCursor};

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
        let mut buckets: [Vec<(PositionKey, Occurrence)>; 256] =
            std::array::from_fn(|_| Vec::new());
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

        let flat = |bs: &[Vec<(PositionKey, Occurrence)>; 256]| {
            bs.iter()
                .flatten()
                .map(|(k, o)| (k.z0, k.z1, o.file_id, o.r#gen, o.node_id))
                .collect::<Vec<_>>()
        };
        assert_eq!(flat(&back.buckets), flat(&buckets));
    }
}
