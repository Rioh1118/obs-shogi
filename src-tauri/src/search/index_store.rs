use std::sync::{Arc, RwLock};

use crate::search::{node_table::NodeTableArc, types::Occurrence};

use super::{
    file_table::FileTable,
    position_key::PositionKey,
    segment::{Segment, SegmentArc},
    types::{FileEntry, FileId},
};

pub type BucketEntries = [Vec<(PositionKey, Occurrence)>; 256];
pub type FileBucketEntries = (FileEntry, NodeTableArc, BucketEntries);

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

    /// 1件検索（完全一致）: PositionKey から全Occurrenceを返す
    ///
    /// - alive 判定は file_table の gen/deleted で行う
    /// - 結果は決定的順序（file_id → node_id）に整列
    pub fn search_occurrences_by_key(&self, key: PositionKey) -> Vec<Occurrence> {
        let bucket = key.bucket() as usize;
        let segs = &self.buckets[bucket];

        let mut out: Vec<Occurrence> = Vec::new();

        for seg in segs {
            let slice = seg.range_by_key(key);
            if slice.is_empty() {
                continue;
            }
            for (_k, occ) in slice {
                if self.file_table.is_occ_alive(occ.file_id, occ.gen) {
                    out.push(*occ);
                }
            }
        }

        out.sort_by(|a, b| (a.file_id, a.node_id).cmp(&(b.file_id, b.node_id)));
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

    /// 現在の不変スナップショットを取得
    pub fn snapshot(&self) -> Arc<IndexSnapshot> {
        self.snap.read().unwrap().clone()
    }

    pub fn start_restoring(&self) {
        let mut guard = self.snap.write().unwrap();
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
        buckets_entries: [Vec<(PositionKey, Occurrence)>; 256],
    ) {
        let buckets: [Vec<SegmentArc>; 256] = std::array::from_fn(|i| {
            let v = buckets_entries[i].clone();
            if v.is_empty() {
                Vec::new()
            } else {
                vec![Arc::new(Segment::new_sorted(v))]
            }
        });

        let mut guard = self.snap.write().unwrap();
        *guard = Arc::new(IndexSnapshot {
            state,
            file_table: Arc::new(file_table),
            node_tables: Arc::new(node_tables),
            buckets,
        });
    }

    /// プロジェクトオープン時：空の Building にリセット
    pub fn start_full_build(&self) {
        let mut guard = self.snap.write().unwrap();
        *guard = Arc::new(IndexSnapshot {
            state: IndexState::Building,
            file_table: Arc::new(FileTable::default()),
            node_tables: Arc::new(NodeTables::default()),
            buckets: std::array::from_fn(|_| Vec::new()),
        });
    }

    /// フルビルド完了：Ready で一括コミット
    pub fn commit_full_build(
        &self,
        file_table: FileTable,
        node_table: NodeTables,
        buckets: [Vec<SegmentArc>; 256],
    ) {
        let mut guard = self.snap.write().unwrap();
        *guard = Arc::new(IndexSnapshot {
            state: IndexState::Ready,
            file_table: Arc::new(file_table),
            node_tables: Arc::new(node_table),
            buckets,
        });
    }

    /// state だけ変えたいとき
    pub fn set_state(&self, state: IndexState) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();
        *guard = Arc::new(IndexSnapshot {
            state,
            file_table: old.file_table.clone(),
            node_tables: old.node_tables.clone(),
            buckets: old.buckets.clone(),
        });
    }

    /// FileEntry を upsert して、bucket別に Segment を追加する（add/update 完了時に呼ぶ想定）
    ///
    /// - entries_by_bucket は key 順ソート済みが望ましい（bucketize_entriesの出力を想定）
    pub fn insert_file_segments(
        &self,
        file_entry: FileEntry,
        nt: NodeTableArc,
        by_bucket: BucketEntries,
    ) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();

        let file_id = file_entry.file_id;

        let mut ft = (*old.file_table).clone();
        ft.upsert(file_entry);

        let mut nts = (*old.node_tables).clone();
        nts.upsert(file_id, nt);

        let mut buckets = old.buckets.clone();
        for (b, v) in by_bucket.into_iter().enumerate() {
            if v.is_empty() {
                continue;
            }
            buckets[b].push(Arc::new(Segment::new_sorted(v)));
        }

        *guard = Arc::new(IndexSnapshot {
            state: old.state,
            file_table: Arc::new(ft),
            node_tables: Arc::new(nts),
            buckets,
        })
    }

    pub fn insert_many_file_segments(&self, items: Vec<FileBucketEntries>) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();

        let mut ft = (*old.file_table).clone();
        let mut nts = (*old.node_tables).clone();
        let mut buckets = old.buckets.clone();

        for (file_entry, nt, by_bucket) in items {
            ft.upsert(file_entry.clone());
            nts.upsert(file_entry.file_id, nt);

            for (b, v) in by_bucket.into_iter().enumerate() {
                if v.is_empty() {
                    continue;
                }
                buckets[b].push(Arc::new(Segment::new_sorted(v)));
            }
        }

        *guard = Arc::new(IndexSnapshot {
            state: old.state,
            file_table: Arc::new(ft),
            node_tables: Arc::new(nts),
            buckets,
        });
    }

    /// ファイル削除（tombstone化）: 既存Segmentは残し、検索時のgenチェックで落とす
    pub fn tombstone_file(&self, file_id: FileId) {
        let mut guard = self.snap.write().unwrap();
        let old = guard.clone();

        let mut ft = (*old.file_table).clone();
        ft.tombstone(file_id);

        *guard = Arc::new(IndexSnapshot {
            state: old.state, // stateは運用次第で Updating にしてもよい
            file_table: Arc::new(ft),
            node_tables: old.node_tables.clone(),
            buckets: old.buckets.clone(),
        });
    }
}
