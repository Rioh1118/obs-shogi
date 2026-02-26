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

const MAGIC: [u8; 8] = *b"OBSIXv01"; // 8 bytes
const VERSION: u32 = 1;

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
    let mut slices: Vec<&[(PositionKey, Occurrence)]> = Vec::with_capacity(segs.len());

    for (si, seg) in segs.iter().enumerate() {
        let s = seg.entries();
        slices.push(s);
        if let Some((k, occ)) = s.first() {
            heap.push(HeapItem {
                key: *k,
                occ: *occ,
                seg: si,
                idx: 0,
            });
        }
    }

    // ざっくり容量予約（正確には無理なので控えめ）
    let mut out: Vec<(PositionKey, Occurrence)> = Vec::new();

    while let Some(item) = heap.pop() {
        // alive のみ残す
        if ft.is_occ_alive(item.occ.file_id, item.occ.gen) {
            out.push((item.key, item.occ));
        }

        let next_i = item.idx + 1;
        let s = slices[item.seg];
        if next_i < s.len() {
            let (k, occ) = s[next_i];
            heap.push(HeapItem {
                key: k,
                occ,
                seg: item.seg,
                idx: next_i,
            });
        }
    }

    // out は heap から key 順で出てくるのでソート済み
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
    let mut entries: Vec<FileEntry> = ctx.ft.iter_all().map(|(_, e)| e.clone()).collect();
    entries.sort_by_key(|e| e.file_id);
    write_u32(w, entries.len() as u32);
    for e in &entries {
        write_u32(w, e.file_id);
        write_u32(w, e.gen);
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
            write_u32(w, occ.gen);
            write_u32(w, occ.node_id);
        }
    }

    Ok(())
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
        let file_id = r.read_u32()?;
        let gen = r.read_u32()?;
        let deleted = r.read_u8()? != 0;
        let path = r.read_string()?;
        ft.upsert(FileEntry {
            file_id,
            gen,
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
        let id = r.read_u32()?;
        path_to_id.insert(p, id);
    }

    // ---- node tables ----
    let nt_len = r.read_u32()? as usize;
    let mut nts = NodeTables::default();
    for _ in 0..nt_len {
        let file_id = r.read_u32()?;
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
            let file_id = r.read_u32()?;
            let gen = r.read_u32()?;
            let node_id = r.read_u32()?;
            v.push((
                PositionKey { z0, z1 },
                Occurrence {
                    file_id,
                    gen,
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
