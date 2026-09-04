use std::sync::Arc;

use parking_lot::RwLock;

use crate::search::store::node_table::{NodeTableArc, NodeTables};
use crate::search::types::Occurrence;

use crate::search::position::position_key::PositionKey;
use crate::search::store::compaction::{compact_bucket, COMPACT_THRESHOLD};
use crate::search::store::file_table::FileTable;
use crate::search::store::segment::Segment;
use crate::search::types::{FileEntry, FileId};

use crate::search::store::bucket::{
    empty_bucket_segments, BucketEntries, BucketSegments, FileBucketEntries, BUCKET_COUNT,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexState {
    Empty,
    Restoring,
    Building,
    Ready,
    Updating,
}

#[derive(Debug, Clone)]
pub struct IndexSnapshot {
    pub state: IndexState,
    pub file_table: Arc<FileTable>,
    pub node_tables: Arc<NodeTables>,
    pub buckets: BucketSegments,
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
            buckets: empty_bucket_segments(),
        }
    }

    /// 鍵に完全一致する出現を、**生きているものだけ**返す。
    ///
    /// 並びは `(file_id, gen, node_id)` 昇順。**桶の中のセグメントが何本に
    /// 割れていても同じ順で出る。** 割れ方は取り込みの刻み方（`COMPACT_THRESHOLD`）で
    /// 決まる内部の都合なので、利用者の一覧の順がそれで変わってはいけない。
    ///
    /// **並べ替えが要る。** セグメントの中は鍵の昇順でしか並んでおらず
    /// （`store/bucket.rs` が鍵だけで安定ソートする）、同じ鍵の区間の中は
    /// 取り込んだ順のまま。合流だけでは順序を作れない。
    ///
    /// 生存判定は `FileTable::is_occ_alive`。削除された棋譜と、
    /// 作り直されて世代が上がった棋譜の古い出現がここで落ちる。
    pub fn search_occurrences_by_key(&self, key: PositionKey) -> Vec<Occurrence> {
        let segs = &self.buckets[key.bucket() as usize];

        let mut out: Vec<Occurrence> = Vec::new();
        for seg in segs {
            let (lo, hi) = seg.range_by_key(key);
            out.reserve(hi - lo);
            for i in lo..hi {
                let occ = seg.occ_at(i);
                if self.file_table.is_occ_alive(occ.file_id, occ.r#gen) {
                    out.push(occ);
                }
            }
        }

        out.sort_unstable_by_key(|o| (o.file_id, o.r#gen, o.node_id));
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
            buckets: empty_bucket_segments(),
        })
    }

    pub fn install_restored(
        &self,
        state: IndexState,
        file_table: FileTable,
        node_tables: NodeTables,
        mut buckets_entries: BucketEntries,
    ) {
        let buckets: BucketSegments = std::array::from_fn(|i| {
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
            buckets: empty_bucket_segments(),
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
        let mut touched: Vec<bool> = vec![false; BUCKET_COUNT];

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::types::{FileEntry, Occurrence};

    /// **同じ検索の結果が、セグメントの本数によらず同じ順で出ること。**
    ///
    /// 桶が何本に割れるかは取り込みの刻み方で決まる内部の都合。
    /// **利用者の一覧の順がそれで変わってはいけない。**
    ///
    /// 題材は `file_id` の降順で詰める —— 昇順で詰めると、
    /// 並べ替えを消しても偶然通る。
    #[test]
    fn the_order_of_a_hit_list_does_not_depend_on_how_the_bucket_is_split() {
        let key = PositionKey { z0: 1, z1: 1 };
        let occ = |f: u32, n: u32| Occurrence {
            file_id: f,
            r#gen: 1,
            node_id: n,
        };

        let mut ft = FileTable::default();
        for f in 1..=4u32 {
            ft.upsert(FileEntry {
                file_id: f,
                path: format!("{f}.kif"),
                deleted: false,
                r#gen: 1,
            });
        }

        // 1本のセグメントに、同じ鍵の出現を file_id 降順で詰める
        let one = Segment::new_sorted(vec![
            (key, occ(4, 0)),
            (key, occ(3, 0)),
            (key, occ(2, 0)),
            (key, occ(1, 0)),
        ]);
        let mut buckets = empty_bucket_segments();
        buckets[key.bucket() as usize] = vec![Arc::new(one)];
        let snap1 = IndexSnapshot {
            state: IndexState::Ready,
            file_table: Arc::new(ft.clone()),
            node_tables: Arc::new(NodeTables::default()),
            buckets,
        };
        let got1: Vec<u32> = snap1
            .search_occurrences_by_key(key)
            .iter()
            .map(|o| o.file_id)
            .collect();

        // 同じ中身を2本に割る
        let a = Segment::new_sorted(vec![(key, occ(4, 0)), (key, occ(3, 0))]);
        let b = Segment::new_sorted(vec![(key, occ(2, 0)), (key, occ(1, 0))]);
        let mut buckets = empty_bucket_segments();
        buckets[key.bucket() as usize] = vec![Arc::new(a), Arc::new(b)];
        let snap2 = IndexSnapshot {
            state: IndexState::Ready,
            file_table: Arc::new(ft),
            node_tables: Arc::new(NodeTables::default()),
            buckets,
        };
        let got2: Vec<u32> = snap2
            .search_occurrences_by_key(key)
            .iter()
            .map(|o| o.file_id)
            .collect();

        assert_eq!(got2, vec![1, 2, 3, 4], "2本のとき file_id 昇順でない");
        assert_eq!(got1, got2, "本数で並びが変わる");
    }
}
