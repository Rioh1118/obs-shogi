//! 索引そのもの。**ある瞬間の値**で、書き換えない。
//!
//! 遷移は全部ここの純関数で、`&self` から次の値を作って返す。
//! ロックを知らないので、そのままテストできる。置き換えは
//! [`SnapshotCell`](super::snapshot_cell::SnapshotCell) の仕事。
//!
//! **ここが変わるのは、索引に何が入るかか、引いた結果の並びの規約が変わるとき。**

use std::sync::Arc;

use crate::search::position::position_key::PositionKey;
use crate::search::store::bucket::{
    empty_bucket_segments, BucketEntries, BucketSegments, FileBucketEntries, BUCKET_COUNT,
};
use crate::search::store::compaction::{compact_bucket, COMPACT_THRESHOLD};
use crate::search::store::file_table::FileTable;
use crate::search::store::node_table::NodeTables;
use crate::search::store::segment::Segment;
use crate::search::types::{FileId, Occurrence};

/// **中身を捨ててよい段。**
///
/// [`IndexSnapshot::restarting`] が受ける。`IndexState` を素で受けない理由は
/// そちらの doc に書いてある。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Restart {
    /// キャッシュから読み戻す
    Restoring,
    /// 棋譜を1つずつ読んで作り直す
    Building,
}

impl From<Restart> for IndexState {
    fn from(at: Restart) -> Self {
        match at {
            Restart::Restoring => IndexState::Restoring,
            Restart::Building => IndexState::Building,
        }
    }
}

/// 索引がいまどの段にいるか。**内部の段で、画面へは出ない。**
///
/// ここから利用者に届くのは `search/query_service.rs` が作る `stale` の真偽1つだけ。
/// 画面が読むのは同名の別型（`search/types.rs` の `IndexState`）で、
/// そちらは payload に手で載せる。**2つは機械では突き合わされていない。**
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexState {
    /// まだ何も無い。プロジェクトを開く前
    Empty,
    /// キャッシュから読み戻している最中
    Restoring,
    /// 棋譜を1つずつ読んで作っている最中
    Building,
    /// 引ける。差分の取り込みも終わっている
    Ready,
    /// 引けるが、ファイルの変更を取り込んでいる最中
    Updating,
}

/// ある瞬間の索引。
///
/// **`file_table` と `node_tables` は `Arc` で写すだけ。**
/// `buckets` は違う —— `[Vec<SegmentArc>; 256]` なので、次の値を作るたびに
/// 256本の `Vec` を確保し直し、載っているセグメントの参照数を全部触る。
/// 遷移を細かく刻むとそのぶん効く。
#[derive(Debug, Clone)]
pub struct IndexSnapshot {
    /// いまどの段か。書き換えるのは [`Self::with_state`]
    pub state: IndexState,
    /// `file_id` → 棋譜のパスと世代。**生きているかの判定はここ**
    pub file_table: Arc<FileTable>,
    /// `file_id` → その棋譜の節表。ヒットを盤の位置に戻すのに要る
    pub node_tables: Arc<NodeTables>,
    /// 鍵の上位8ビットで振り分けた256本の桶
    pub buckets: BucketSegments,
}

impl Default for IndexSnapshot {
    /// **まだ何も無い索引。** プロジェクトを開く前だけ。
    fn default() -> Self {
        Self {
            state: IndexState::Empty,
            file_table: Arc::new(FileTable::default()),
            node_tables: Arc::new(NodeTables::default()),
            buckets: empty_bucket_segments(),
        }
    }
}

impl IndexSnapshot {
    /// **中身を捨てて、これから作り直す索引。**
    ///
    /// 復元を始めるときと全件構築を始めるときに使う。中身は同じで段だけ違う。
    ///
    /// **段を [`Restart`] に絞ってある。** `IndexState` を素で受けると
    /// 「空にして `Ready` を名乗る」が書けてしまい、`query_service` が
    /// `stale = false` を返して**空の結果が「新鮮で正しい」として画面に並ぶ** ——
    /// エラーもログも出ない。捨ててよい段は2つだけ。
    pub fn restarting(at: Restart) -> Self {
        Self {
            state: at.into(),
            file_table: Arc::new(FileTable::default()),
            node_tables: Arc::new(NodeTables::default()),
            buckets: empty_bucket_segments(),
        }
    }

    /// 状態だけ差し替える。中身は写すだけ。
    pub fn with_state(&self, state: IndexState) -> Self {
        Self {
            state,
            file_table: self.file_table.clone(),
            node_tables: self.node_tables.clone(),
            buckets: self.buckets.clone(),
        }
    }

    /// キャッシュから読み戻した中身で、丸ごと組み直す。
    ///
    /// **桶の素材を引ける形に直すのがここの仕事。** `BucketEntries` は
    /// 鍵の昇順に並んだ `Vec` で、そのままでは二分探索できない。
    /// [`Segment::new_sorted`] が列に詰め替える。
    ///
    /// 素材が昇順であることは `cache/index_cache.rs` の `decode_all` が
    /// 桶ごとに確かめてから渡す（崩れていればキャッシュごと捨てる）。
    pub fn restored(
        state: IndexState,
        file_table: FileTable,
        node_tables: NodeTables,
        mut entries: BucketEntries,
    ) -> Self {
        let buckets: BucketSegments = std::array::from_fn(|i| {
            let v = std::mem::take(&mut entries[i]);
            if v.is_empty() {
                Vec::new()
            } else {
                vec![Arc::new(Segment::new_sorted(v))]
            }
        });

        Self {
            state,
            file_table: Arc::new(file_table),
            node_tables: Arc::new(node_tables),
            buckets,
        }
    }

    /// 読み終えた棋譜たちを取り込んだ、次の索引。**積み増す。置き換えではない。**
    ///
    /// **桶にはセグメントを積み増す。** その場で畳まないのは、
    /// 取り込みが1件ずつ来るのに対して畳むのは桶の全件を舐めるため。
    /// 積み増した桶だけを見て、`COMPACT_THRESHOLD`（`store/compaction.rs`）を
    /// 超えていたら畳む。
    ///
    /// 状態は変えない。取り込みの最中がどの状態かは呼び手が決める。
    pub fn with_files(&self, items: Vec<FileBucketEntries>) -> Self {
        let mut file_table = (*self.file_table).clone();
        let mut node_tables = (*self.node_tables).clone();
        let mut buckets = self.buckets.clone();
        let mut touched = vec![false; BUCKET_COUNT];

        for (file_entry, nt, by_bucket) in items {
            node_tables.upsert(file_entry.file_id, nt);
            file_table.upsert(file_entry);

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
                buckets[b] = match compact_bucket(&buckets[b], &file_table) {
                    Some(merged) => vec![Arc::new(merged)],
                    // 生きている出現が1つも残らなかった桶
                    None => Vec::new(),
                };
            }
        }

        Self {
            state: self.state,
            file_table: Arc::new(file_table),
            node_tables: Arc::new(node_tables),
            buckets,
        }
    }

    /// その棋譜を消したことにした、次の索引。
    ///
    /// **桶からは消さない。** 出現は残ったまま、検索のたびに
    /// `is_occ_alive` で弾かれる。実際に消えるのはその桶を畳むとき。
    /// 節表も残す —— `file_id` は使い回さないので、消しても空きが埋まらない。
    /// **代償はある**（`docs/state-transitions/search.md` の「出現ゼロの節表」）。
    pub fn with_tombstone(&self, file_id: FileId) -> Self {
        let mut file_table = (*self.file_table).clone();
        file_table.tombstone(file_id);

        Self {
            state: self.state,
            file_table: Arc::new(file_table),
            node_tables: self.node_tables.clone(),
            buckets: self.buckets.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::store::node_table::{NodeTableArc, NodeTableBuilder};
    use crate::search::types::FileEntry;

    /// **同じ検索の結果が、セグメントの本数によらず同じ順で出ること。**
    ///
    /// 桶が何本に割れるかは取り込みの刻み方で決まる内部の都合。
    /// **利用者の一覧の順がそれで変わってはいけない。**
    ///
    /// 題材は `file_id` の降順で詰める —— 昇順で詰めると、
    /// 並べ替えを消しても偶然通る。
    fn key_of(z0: u64) -> PositionKey {
        PositionKey { z0, z1: 0 }
    }

    fn occ_of(file_id: u32, node_id: u32) -> Occurrence {
        Occurrence {
            file_id,
            r#gen: 1,
            node_id,
        }
    }

    fn entry_of(file_id: u32) -> FileEntry {
        FileEntry {
            file_id,
            path: format!("{file_id}.kif"),
            deleted: false,
            r#gen: 1,
        }
    }

    fn node_table_of(nodes: u32) -> NodeTableArc {
        let mut b = NodeTableBuilder::new();
        for n in 0..nodes {
            b.push_node(n, &[]);
        }
        Arc::new(b.finish())
    }

    /// 1ファイル分の取り込みの素材。桶は `key` の落ちる1本だけ。
    fn one_file(file_id: u32, key: PositionKey, node_id: u32) -> FileBucketEntries {
        let mut by_bucket: BucketEntries = crate::search::store::bucket::empty_buckets();
        by_bucket[key.bucket() as usize].push((key, occ_of(file_id, node_id)));
        (entry_of(file_id), node_table_of(node_id + 1), by_bucket)
    }

    /// **取り込みは積み増す。置き換えない。**
    ///
    /// `with_files` を2回呼んだあと、1回目のファイルのヒットも残ること。
    #[test]
    fn with_files_adds_to_what_is_already_there() {
        let k = key_of(0x1100_0000_0000_0001);
        let snap = IndexSnapshot::default()
            .with_files(vec![one_file(1, k, 0)])
            .with_files(vec![one_file(2, k, 0)]);

        let got: Vec<u32> = snap
            .search_occurrences_by_key(k)
            .iter()
            .map(|o| o.file_id)
            .collect();

        assert_eq!(got, vec![1, 2], "先に入れたファイルが消えている");
        assert!(snap.node_tables.get(1).is_some(), "節表も残ること");
        assert!(snap.node_tables.get(2).is_some());
    }

    /// **しきい値を超えるまで畳まない。超えたら1本になる。**
    ///
    /// 畳む条件は `> COMPACT_THRESHOLD` なので、ちょうどの本数では畳まない。
    /// 境界を両側から見る。
    #[test]
    fn a_bucket_is_folded_only_after_it_passes_the_threshold() {
        let k = key_of(0x2200_0000_0000_0001);
        let b = k.bucket() as usize;

        let mut at = IndexSnapshot::default();
        for i in 0..COMPACT_THRESHOLD {
            at = at.with_files(vec![one_file(i as u32 + 1, k, 0)]);
        }
        assert_eq!(
            at.buckets[b].len(),
            COMPACT_THRESHOLD,
            "しきい値ちょうどで畳んでいる"
        );

        let over = at.with_files(vec![one_file(COMPACT_THRESHOLD as u32 + 1, k, 0)]);
        assert_eq!(over.buckets[b].len(), 1, "しきい値を超えても畳んでいない");

        // 畳んでも中身は落ちない
        assert_eq!(
            over.search_occurrences_by_key(k).len(),
            COMPACT_THRESHOLD + 1,
            "畳んだときに出現が消えた"
        );
    }

    /// **墓標を立てても、桶と節表はそのまま残る。**
    ///
    /// 消えるのは検索の結果だけ。桶から実際に消えるのはその桶を畳むとき
    /// （`store/compaction.rs`）。節表を残すのは `docs/state-transitions/search.md`
    /// の「出現ゼロの節表」の前提になっている。
    #[test]
    fn a_tombstone_hides_the_hits_but_keeps_the_tables() {
        let k = key_of(0x3300_0000_0000_0001);
        let b = k.bucket() as usize;
        let snap = IndexSnapshot::default().with_files(vec![one_file(1, k, 0), one_file(2, k, 0)]);
        let segments_before = snap.buckets[b].len();

        let after = snap.with_tombstone(1);

        let got: Vec<u32> = after
            .search_occurrences_by_key(k)
            .iter()
            .map(|o| o.file_id)
            .collect();
        assert_eq!(got, vec![2], "墓標を立てた棋譜のヒットが残っている");
        assert_eq!(
            after.buckets[b].len(),
            segments_before,
            "桶から消してしまっている"
        );
        assert!(
            after.node_tables.get(1).is_some(),
            "節表まで落としてしまっている"
        );
    }

    /// **段だけ差し替えても中身は動かない。**
    #[test]
    fn with_state_leaves_everything_else_alone() {
        let k = key_of(0x4400_0000_0000_0001);
        let snap = IndexSnapshot::default().with_files(vec![one_file(1, k, 0)]);

        let ready = snap.with_state(IndexState::Ready);

        assert_eq!(ready.state, IndexState::Ready);
        assert_eq!(ready.search_occurrences_by_key(k).len(), 1);
        assert!(ready.node_tables.get(1).is_some());
    }

    /// **作り直しに入るときは中身を捨てる。**
    #[test]
    fn restarting_throws_the_index_away() {
        let k = key_of(0x5500_0000_0000_0001);
        let _ = IndexSnapshot::default().with_files(vec![one_file(1, k, 0)]);

        for at in [Restart::Restoring, Restart::Building] {
            let fresh = IndexSnapshot::restarting(at);
            assert!(fresh.search_occurrences_by_key(k).is_empty());
            assert!(fresh.node_tables.get(1).is_none());
            assert_eq!(fresh.state, at.into());
        }
    }

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
