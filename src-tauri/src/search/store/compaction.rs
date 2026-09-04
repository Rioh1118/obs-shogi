//! 桶を1本に畳む。
//!
//! 取り込みは桶にセグメントを積み増していくので、放っておくと
//! 1つの桶に何本も溜まって二分探索が本数ぶん走る。**本数がしきい値を
//! 超えた桶だけ**、鍵の昇順に合流させて1本にする。
//!
//! **持っているのは畳み方（合流の順序と生存判定）だけ。**
//! いつ畳むかは `store/snapshot.rs` の `with_files` が決める。

use std::{cmp::Ordering, collections::BinaryHeap};

use crate::search::position::position_key::PositionKey;
use crate::search::store::file_table::FileTable;
use crate::search::store::segment::{Segment, SegmentArc};
use crate::search::types::Occurrence;

/// 桶の中のセグメント数がこれを超えたら1本に畳む。
///
/// **小さくすると畳む回数が増え、大きくすると検索の二分探索が本数ぶん走る。**
/// 実測で決めた値ではない。
pub(super) const COMPACT_THRESHOLD: usize = 64;

/// 合流中の、1つの入力セグメントの先頭。
///
/// **鍵の並びは `PositionKey` の `Ord` に任せる。** ここで組み直すと、
/// 並べる側（`store/bucket.rs`）と食い違ったときに畳んだ結果の順序が黙って壊れる。
///
/// **同じ鍵が並んだときの尾は `(file_id, node_id)`。** セグメントの番号を
/// 尾にすると、同じ中身でも桶の割れ方で畳んだ結果の並びが変わる。
/// 引く側（`store/snapshot.rs` の `search_occurrences_by_key`）が
/// 同じ順を約束しているので、畳む側もそれに合わせる。
#[derive(Clone, Copy)]
struct KeyHead {
    key: PositionKey,
    occ: Occurrence,
    seg: usize,
    idx: usize,
}

impl Ord for KeyHead {
    fn cmp(&self, other: &Self) -> Ordering {
        // `BinaryHeap` は最大ヒープなので、最小を取り出すために反転する
        (other.key, other.occ.file_id, other.occ.node_id).cmp(&(
            self.key,
            self.occ.file_id,
            self.occ.node_id,
        ))
    }
}

impl PartialOrd for KeyHead {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for KeyHead {
    fn eq(&self, other: &Self) -> bool {
        (self.key, self.occ.file_id, self.occ.node_id)
            == (other.key, other.occ.file_id, other.occ.node_id)
    }
}

impl Eq for KeyHead {}

/// 桶の全セグメントを鍵の昇順に合流させ、**生きている出現だけ**を残した
/// 1本のセグメントを返す。1件も残らなければ `None`。
///
/// **入力はどれも鍵の昇順**（`Segment::new_sorted` の前提）なので、
/// ここは合流で順序を作れる。検索側と違うのはそこ ——
/// あちらは同じ鍵の区間の中を並べ替えたいので、合流では作れない。
///
/// 死んだ出現（削除された棋譜・世代の上がった棋譜）はここで消える。
/// **畳むまで消えない**ので、`COMPACT_THRESHOLD` に届かない桶は
/// 死んだ出現を抱えたまま検索のたびに `is_occ_alive` で弾き続ける。
/// 桶の全セグメントを合流させ、**生きている出現だけ**を鍵の昇順で返す。
///
/// **入力はどれも鍵の昇順**（`Segment::new_sorted` の前提）なので、
/// ここは合流で順序を作れる。引く側と違うのはそこ ——
/// あちらは同じ鍵の区間の中を並べ替えたいので、合流では作れない。
///
/// 死んだ出現（削除された棋譜・世代の上がった棋譜）はここで消える。
/// **畳むまで消えない**ので、`COMPACT_THRESHOLD` に届かない桶は
/// 死んだ出現を抱えたまま検索のたびに `is_occ_alive` で弾き続ける。
pub(in crate::search) fn compact_bucket_entries(
    segs: &[SegmentArc],
    ft: &FileTable,
) -> Vec<(PositionKey, Occurrence)> {
    let mut heap = BinaryHeap::<KeyHead>::with_capacity(segs.len());
    let push_at = |heap: &mut BinaryHeap<KeyHead>, si: usize, idx: usize| {
        let seg: &SegmentArc = &segs[si];
        if idx < seg.len() {
            heap.push(KeyHead {
                key: seg.key_at(idx),
                occ: seg.occ_at(idx),
                seg: si,
                idx,
            });
        }
    };

    for si in 0..segs.len() {
        push_at(&mut heap, si, 0);
    }

    let mut out = Vec::with_capacity(segs.iter().map(|s| s.len()).sum());
    while let Some(item) = heap.pop() {
        if ft.is_occ_alive(item.occ.file_id, item.occ.r#gen) {
            out.push((item.key, item.occ));
        }
        push_at(&mut heap, item.seg, item.idx + 1);
    }
    out
}

/// [`compact_bucket_entries`] を1本のセグメントに詰め替える。1件も残らなければ `None`。
pub(super) fn compact_bucket(segs: &[SegmentArc], ft: &FileTable) -> Option<Segment> {
    let entries = compact_bucket_entries(segs, ft);
    if entries.is_empty() {
        return None;
    }
    Some(Segment::new_sorted(entries))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::types::FileEntry;
    use std::sync::Arc;

    fn key(z0: u64) -> PositionKey {
        PositionKey { z0, z1: 0 }
    }

    fn occ(file_id: u32, node_id: u32) -> Occurrence {
        Occurrence {
            file_id,
            r#gen: 1,
            node_id,
        }
    }

    fn alive(ids: &[u32]) -> FileTable {
        let mut ft = FileTable::default();
        for id in ids {
            ft.upsert(FileEntry {
                file_id: *id,
                path: format!("{id}.kif"),
                deleted: false,
                r#gen: 1,
            });
        }
        ft
    }

    fn seg(entries: Vec<(PositionKey, Occurrence)>) -> SegmentArc {
        Arc::new(Segment::new_sorted(entries))
    }

    /// **同じ鍵の並びが、桶の割れ方で変わらないこと。**
    ///
    /// 尾をセグメントの番号にすると、同じ中身でも積んだ順で結果が変わる。
    /// 引く側（`store/snapshot.rs`）が `(file_id, node_id)` 昇順を約束しているので、
    /// 畳んだ結果もその順でないと、畳む前と後で並びが変わる。
    ///
    /// 題材は**セグメントの番号と `file_id` が逆**になるように積む。
    /// 揃えて積むと、尾をどちらにしても同じ結果になって変異が生き残る。
    #[test]
    fn the_tie_break_is_decided_by_the_occurrence_not_by_the_segment() {
        let k = key(1);
        let segs = [
            seg(vec![(k, occ(3, 0))]),
            seg(vec![(k, occ(1, 0))]),
            seg(vec![(k, occ(2, 0))]),
        ];

        let got: Vec<u32> = compact_bucket_entries(&segs, &alive(&[1, 2, 3]))
            .iter()
            .map(|(_, o)| o.file_id)
            .collect();

        assert_eq!(got, vec![1, 2, 3], "積んだ順が結果に出ている");
    }

    /// **死んだ出現は畳むときに消える。**
    #[test]
    fn a_dead_occurrence_is_dropped_when_the_bucket_is_folded() {
        let k = key(1);
        let segs = [seg(vec![(k, occ(1, 0)), (k, occ(2, 0))])];

        // file 2 はファイル表に無い = 死んでいる
        let got = compact_bucket_entries(&segs, &alive(&[1]));

        assert_eq!(got.len(), 1, "死んだ出現が残っている");
        assert_eq!(got[0].1.file_id, 1);
    }

    /// **1件も生きていない桶は `None`。**
    ///
    /// `Some(空のセグメント)` を返すと、桶に空の1本が積まれ続ける。
    #[test]
    fn a_bucket_with_nothing_alive_folds_to_nothing() {
        let segs = [seg(vec![(key(1), occ(9, 0))])];
        assert!(compact_bucket(&segs, &alive(&[1])).is_none());
    }

    /// **鍵をまたいだ並びは昇順。**
    #[test]
    fn keys_come_out_in_ascending_order() {
        let segs = [
            seg(vec![(key(1), occ(1, 0)), (key(5), occ(1, 1))]),
            seg(vec![(key(3), occ(2, 0))]),
        ];

        let got: Vec<u64> = compact_bucket_entries(&segs, &alive(&[1, 2]))
            .iter()
            .map(|(k, _)| k.z0)
            .collect();

        assert_eq!(got, vec![1, 3, 5]);
    }
}
