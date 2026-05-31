use std::{cmp::Ordering, collections::BinaryHeap, sync::Arc};

use parking_lot::RwLock;

use crate::search::{node_table::NodeTableArc, types::Occurrence};

use super::{
    file_table::FileTable,
    position_key::PositionKey,
    segment::{Segment, SegmentArc},
    types::{FileEntry, FileId},
};

pub type BucketEntries = [Vec<(PositionKey, Occurrence)>; 256];
pub type FileBucketEntries = (FileEntry, NodeTableArc, BucketEntries);

/// bucket 内のセグメント数がこれを超えたら k-way merge で 1 本に圧縮する。
const COMPACT_THRESHOLD: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexState {
    Empty,
    Restoring,
    Building,
    Ready,
    Updating,
}

#[derive(Debug, Clone, Default)]
pub struct NodeTables {
    by_id: Vec<Option<NodeTableArc>>,
}

impl NodeTables {
    pub fn get(&self, file_id: FileId) -> Option<&NodeTableArc> {
        self.by_id.get(file_id as usize)?.as_ref()
    }

    pub fn upsert(&mut self, file_id: FileId, nt: NodeTableArc) {
        let idx = file_id as usize;
        if self.by_id.len() <= idx {
            self.by_id.resize_with(idx + 1, || None);
        }
        self.by_id[idx] = Some(nt);
    }

    pub fn by_id_iter(&self) -> impl Iterator<Item = &Option<NodeTableArc>> {
        self.by_id.iter()
    }
}

#[derive(Debug, Clone)]
pub struct IndexSnapshot {
    pub state: IndexState,
    pub file_table: Arc<FileTable>,
    pub node_tables: Arc<NodeTables>,
    pub buckets: [Vec<SegmentArc>; 256],
}

impl Default for IndexSnapshot {
    fn default() -> Self {
        Self::empty()
    }
}

impl IndexSnapshot {
    pub fn empty() -> Self {
        Self {
            state: IndexState::Empty,
            file_table: Arc::new(FileTable::default()),
            node_tables: Arc::new(NodeTables::default()),
            buckets: std::array::from_fn(|_| Vec::new()),
        }
    }

    /// 1 件検索 (完全一致): PositionKey から全 Occurrence を返す。
    ///
    /// - alive 判定は file_table の O(1) 配列アクセス
    /// - segments が 2 本以上のときは k-way merge で `(file_id, node_id)` 昇順に出す
    pub fn search_occurrences_by_key(&self, key: PositionKey) -> Vec<Occurrence> {
        let bucket = key.bucket() as usize;
        let segs = &self.buckets[bucket];

        let mut ranges: Vec<(SegmentArc, usize, usize)> = Vec::with_capacity(segs.len());
        let mut estimated = 0usize;
        for seg in segs {
            let (lo, hi) = seg.range_by_key(key);
            if lo < hi {
                estimated += hi - lo;
                ranges.push((seg.clone(), lo, hi));
            }
        }

        let mut out: Vec<Occurrence> = Vec::with_capacity(estimated);

        if ranges.len() <= 1 {
            for (seg, lo, hi) in &ranges {
                for i in *lo..*hi {
                    let occ = seg.occ_at(i);
                    if self.file_table.is_occ_alive(occ.file_id, occ.r#gen) {
                        out.push(occ);
                    }
                }
            }
            return out;
        }

        #[derive(Clone, Copy)]
        struct HeapItem {
            file_id: u32,
            node_id: u32,
            occ: Occurrence,
            ri: usize,
            idx: usize,
        }
        impl Ord for HeapItem {
            fn cmp(&self, other: &Self) -> Ordering {
                (other.file_id, other.node_id).cmp(&(self.file_id, self.node_id))
            }
        }
        impl PartialOrd for HeapItem {
            fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
                Some(self.cmp(other))
            }
        }
        impl PartialEq for HeapItem {
            fn eq(&self, other: &Self) -> bool {
                self.file_id == other.file_id && self.node_id == other.node_id
            }
        }
        impl Eq for HeapItem {}

        let mut heap: BinaryHeap<HeapItem> = BinaryHeap::with_capacity(ranges.len());

        let push_first_alive = |heap: &mut BinaryHeap<HeapItem>,
                                ri: usize,
                                seg: &SegmentArc,
                                mut idx: usize,
                                hi: usize,
                                ft: &FileTable| {
            while idx < hi {
                let occ = seg.occ_at(idx);
                if ft.is_occ_alive(occ.file_id, occ.r#gen) {
                    heap.push(HeapItem {
                        file_id: occ.file_id,
                        node_id: occ.node_id,
                        occ,
                        ri,
                        idx,
                    });
                    return;
                }
                idx += 1;
            }
        };

        for (ri, (seg, lo, hi)) in ranges.iter().enumerate() {
            push_first_alive(&mut heap, ri, seg, *lo, *hi, &self.file_table);
        }

        while let Some(item) = heap.pop() {
            out.push(item.occ);
            let (seg, _lo, hi) = &ranges[item.ri];
            push_first_alive(&mut heap, item.ri, seg, item.idx + 1, *hi, &self.file_table);
        }

        out
    }
}

#[derive(Debug, Default)]
pub struct IndexStore {
    snap: RwLock<Arc<IndexSnapshot>>,
}

impl IndexStore {
    pub fn new() -> Self {
        Self {
            snap: RwLock::new(Arc::new(IndexSnapshot::empty())),
        }
    }

    pub fn snapshot(&self) -> Arc<IndexSnapshot> {
        self.snap.read().clone()
    }

    pub fn start_restoring(&self) {
        let mut guard = self.snap.write();
        *guard = Arc::new(IndexSnapshot {
            state: IndexState::Restoring,
            file_table: Arc::new(FileTable::default()),
            node_tables: Arc::new(NodeTables::default()),
            buckets: std::array::from_fn(|_| Vec::new()),
        })
    }

    pub fn install_restored(
        &self,
        state: IndexState,
        file_table: FileTable,
        node_tables: NodeTables,
        mut buckets_entries: [Vec<(PositionKey, Occurrence)>; 256],
    ) {
        let buckets: [Vec<SegmentArc>; 256] = std::array::from_fn(|i| {
            let v = std::mem::take(&mut buckets_entries[i]);
            if v.is_empty() {
                Vec::new()
            } else {
                vec![Arc::new(Segment::new_sorted(v))]
            }
        });

        let mut guard = self.snap.write();
        *guard = Arc::new(IndexSnapshot {
            state,
            file_table: Arc::new(file_table),
            node_tables: Arc::new(node_tables),
            buckets,
        });
    }

    pub fn start_full_build(&self) {
        let mut guard = self.snap.write();
        *guard = Arc::new(IndexSnapshot {
            state: IndexState::Building,
            file_table: Arc::new(FileTable::default()),
            node_tables: Arc::new(NodeTables::default()),
            buckets: std::array::from_fn(|_| Vec::new()),
        });
    }

    pub fn set_state(&self, state: IndexState) {
        let mut guard = self.snap.write();
        let old = guard.clone();
        *guard = Arc::new(IndexSnapshot {
            state,
            file_table: old.file_table.clone(),
            node_tables: old.node_tables.clone(),
            buckets: old.buckets.clone(),
        });
    }

    /// 単発 upsert は many に集約 (snapshot clone を 1 回で済ます)。
    pub fn insert_file_segments(
        &self,
        file_entry: FileEntry,
        nt: NodeTableArc,
        by_bucket: BucketEntries,
    ) {
        self.insert_many_file_segments(vec![(file_entry, nt, by_bucket)]);
    }

    pub fn insert_many_file_segments(&self, items: Vec<FileBucketEntries>) {
        if items.is_empty() {
            return;
        }

        let mut guard = self.snap.write();
        let old = guard.clone();

        let mut ft = (*old.file_table).clone();
        let mut nts = (*old.node_tables).clone();
        let mut buckets = old.buckets.clone();
        let mut touched: Vec<bool> = vec![false; 256];

        for (file_entry, nt, by_bucket) in items {
            ft.upsert(file_entry.clone());
            nts.upsert(file_entry.file_id, nt);

            for (b, v) in by_bucket.into_iter().enumerate() {
                if v.is_empty() {
                    continue;
                }
                buckets[b].push(Arc::new(Segment::new_sorted(v)));
                touched[b] = true;
            }
        }

        for (b, is_touched) in touched.iter().enumerate() {
            if *is_touched && buckets[b].len() > COMPACT_THRESHOLD {
                if let Some(merged) = compact_bucket(&buckets[b], &ft) {
                    buckets[b] = vec![Arc::new(merged)];
                } else {
                    buckets[b].clear();
                }
            }
        }

        *guard = Arc::new(IndexSnapshot {
            state: old.state,
            file_table: Arc::new(ft),
            node_tables: Arc::new(nts),
            buckets,
        });
    }

    pub fn tombstone_file(&self, file_id: FileId) {
        let mut guard = self.snap.write();
        let old = guard.clone();

        let mut ft = (*old.file_table).clone();
        ft.tombstone(file_id);

        *guard = Arc::new(IndexSnapshot {
            state: old.state,
            file_table: Arc::new(ft),
            node_tables: old.node_tables.clone(),
            buckets: old.buckets.clone(),
        });
    }
}

/// bucket 内の全 segment を k-way merge し、alive Occurrence のみ残した 1 本の
/// Segment を返す。エントリが 1 件もなければ None。
fn compact_bucket(segs: &[SegmentArc], ft: &FileTable) -> Option<Segment> {
    if segs.is_empty() {
        return None;
    }

    #[derive(Clone, Copy)]
    struct HeapItem {
        z0: u64,
        z1: u64,
        seg: usize,
        idx: usize,
    }
    impl Ord for HeapItem {
        fn cmp(&self, other: &Self) -> Ordering {
            (other.z0, other.z1, other.seg, other.idx).cmp(&(self.z0, self.z1, self.seg, self.idx))
        }
    }
    impl PartialOrd for HeapItem {
        fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
            Some(self.cmp(other))
        }
    }
    impl PartialEq for HeapItem {
        fn eq(&self, other: &Self) -> bool {
            self.z0 == other.z0
                && self.z1 == other.z1
                && self.seg == other.seg
                && self.idx == other.idx
        }
    }
    impl Eq for HeapItem {}

    let total: usize = segs.iter().map(|s| s.len()).sum();
    let mut z0 = Vec::with_capacity(total);
    let mut z1 = Vec::with_capacity(total);
    let mut file_ids = Vec::with_capacity(total);
    let mut gens = Vec::with_capacity(total);
    let mut node_ids = Vec::with_capacity(total);

    let mut heap = BinaryHeap::<HeapItem>::with_capacity(segs.len());
    for (si, seg) in segs.iter().enumerate() {
        if seg.is_empty() {
            continue;
        }
        let key = seg.key_at(0);
        heap.push(HeapItem {
            z0: key.z0,
            z1: key.z1,
            seg: si,
            idx: 0,
        });
    }

    while let Some(item) = heap.pop() {
        let seg = &segs[item.seg];
        let occ = seg.occ_at(item.idx);
        if ft.is_occ_alive(occ.file_id, occ.r#gen) {
            z0.push(item.z0);
            z1.push(item.z1);
            file_ids.push(occ.file_id);
            gens.push(occ.r#gen);
            node_ids.push(occ.node_id);
        }

        let next = item.idx + 1;
        if next < seg.len() {
            let key = seg.key_at(next);
            heap.push(HeapItem {
                z0: key.z0,
                z1: key.z1,
                seg: item.seg,
                idx: next,
            });
        }
    }

    if z0.is_empty() {
        None
    } else {
        Some(Segment::from_soa(z0, z1, file_ids, gens, node_ids))
    }
}
