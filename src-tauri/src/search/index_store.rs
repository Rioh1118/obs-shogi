use std::sync::{Arc, RwLock};

use super::{
    file_table::FileTable,
    position_key::PositionKey,
    segment::{Segment, SegmentArc},
    types::{FileEntry, FileId, PositionHit},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexState {
    Empty,
    Building,
    Ready,
    Updating,
}

#[derive(Debug, Clone)]
pub struct IndexSnapshot {
    pub state: IndexState,
    pub file_table: Arc<FileTable>,
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
            buckets: std::array::from_fn(|_| Vec::new()),
        }
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

    /// 現在の不変スナップショットを取得
    pub fn snapshot(&self) -> Arc<IndexSnapshot> {
        self.snap.read().unwrap().clone()
    }

    /// プロジェクトオープン時：空の Building にリセット
    pub fn start_full_build(&self) {
        let mut guard = self.snap.write().unwrap();
        let new_snap = Arc::new(IndexSnapshot {
            state: IndexState::Building,
            file_table: Arc::new(FileTable::default()),
            buckets: std::array::from_fn(|_| Vec::new()),
        });
        *guard = new_snap;
    }

    /// フルビルド完了：Ready で一括コミット
    pub fn commit_full_build(&self, file_table: FileTable, buckets: [Vec<SegmentArc>; 256]) {
        let mut guard = self.snap.write().unwrap();
        let new_snap = Arc::new(IndexSnapshot {
            state: IndexState::Ready,
            file_table: Arc::new(file_table),
            buckets,
        });
        *guard = new_snap;
    }

    /// state だけ変えたいとき
    pub fn set_state(&self, state: IndexState) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();
        let new_snap = Arc::new(IndexSnapshot {
            state,
            file_table: old.file_table.clone(),
            buckets: old.buckets.clone(),
        });
        *guard = new_snap;
    }

    /// FileEntry を upsert して、bucket別に Segment を追加する（add/update 完了時に呼ぶ想定）
    ///
    /// - entries_by_bucket は key 順ソート済みが望ましい（bucketize_entriesの出力を想定）
    pub fn insert_file_segments(
        &self,
        file_entry: FileEntry,
        entries_by_bucket: [Vec<(PositionKey, PositionHit)>; 256],
    ) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();

        let mut ft = (*old.file_table).clone();
        ft.upsert(file_entry);

        let mut buckets = old.buckets.clone();
        for (b, v) in entries_by_bucket.into_iter().enumerate() {
            if v.is_empty() {
                continue;
            }
            let seg = Arc::new(Segment::new_sorted(v));
            buckets[b].push(seg);
        }

        let new_snap = Arc::new(IndexSnapshot {
            state: old.state,
            file_table: Arc::new(ft),
            buckets,
        });

        *guard = new_snap;
    }

    pub fn insert_many_file_segments(
        &self,
        items: Vec<(FileEntry, [Vec<(PositionKey, PositionHit)>; 256])>,
    ) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();

        let mut ft = (*old.file_table).clone();
        let mut buckets = old.buckets.clone();

        for (file_entry, entries_by_bucket) in items {
            ft.upsert(file_entry);
            for (b, v) in entries_by_bucket.into_iter().enumerate() {
                if v.is_empty() {
                    continue;
                }
                buckets[b].push(Arc::new(Segment::new_sorted(v)));
            }
        }

        *guard = Arc::new(IndexSnapshot {
            state: old.state,
            file_table: Arc::new(ft),
            buckets,
        });
    }

    /// ファイル削除（tombstone化）: 既存Segmentは残し、検索時のgenチェックで落とす
    pub fn tombstone_file(&self, file_id: FileId) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();

        let mut ft = (*old.file_table).clone();
        ft.tombstone(file_id);

        let new_snap = Arc::new(IndexSnapshot {
            state: old.state, // stateは運用次第で Updating にしてもよい
            file_table: Arc::new(ft),
            buckets: old.buckets.clone(),
        });

        *guard = new_snap;
    }

    /// 1件検索（完全一致）: PositionKey から全Occurrenceを返す
    ///
    /// - 結果は決定的順序（file_id → node_id）に整列
    pub fn search_by_key(&self, key: PositionKey) -> Vec<PositionHit> {
        let snap = self.snapshot();

        let bucket = key.bucket() as usize;
        let segs = &snap.buckets[bucket];

        let mut out: Vec<PositionHit> = Vec::new();

        for seg in segs {
            let slice = seg.range_by_key(key);
            if slice.is_empty() {
                continue;
            }
            for (_k, hit) in slice {
                let occ = hit.occ;
                if snap.file_table.is_occ_alive(occ.file_id, occ.gen) {
                    out.push(hit.clone());
                }
            }
        }

        out.sort_by(|a, b| (a.occ.file_id, a.occ.node_id).cmp(&(b.occ.file_id, b.occ.node_id)));

        out
    }
}
