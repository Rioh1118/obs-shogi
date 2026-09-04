//! 桶を1本に畳む。
//!
//! 取り込みは桶にセグメントを積み増していくので、放っておくと
//! 1つの桶に何本も溜まって二分探索が本数ぶん走る。**本数がしきい値を
//! 超えた桶だけ**、鍵の昇順に合流させて1本にする。
//!
//! **畳む方針が変わるときだけ、このファイルが変わる。**

use std::{cmp::Ordering, collections::BinaryHeap};

use crate::search::position::position_key::PositionKey;
use crate::search::store::file_table::FileTable;
use crate::search::store::segment::{Segment, SegmentArc};

/// 桶の中のセグメント数がこれを超えたら1本に畳む。
///
/// **小さくすると畳む回数が増え、大きくすると検索の二分探索が本数ぶん走る。**
/// 実測で決めた値ではない。
pub(super) const COMPACT_THRESHOLD: usize = 64;

/// 合流中の、1つの入力セグメントの先頭。
///
/// **鍵の並びは `PositionKey` の `Ord` に任せる。** ここで組み直すと、
/// 並べる側（`store/bucket.rs`）と食い違ったときに畳んだ結果の順序が黙って壊れる。
/// `seg` / `idx` は同じ鍵が並んだときに順序を決めきるためだけの尾。
#[derive(Clone, Copy, PartialEq, Eq)]
struct KeyHead {
    key: PositionKey,
    seg: usize,
    idx: usize,
}

impl Ord for KeyHead {
    fn cmp(&self, other: &Self) -> Ordering {
        // `BinaryHeap` は最大ヒープなので、最小を取り出すために反転する
        (other.key, other.seg, other.idx).cmp(&(self.key, self.seg, self.idx))
    }
}

impl PartialOrd for KeyHead {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

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
pub(super) fn compact_bucket(segs: &[SegmentArc], ft: &FileTable) -> Option<Segment> {
    if segs.is_empty() {
        return None;
    }

    let total: usize = segs.iter().map(|s| s.len()).sum();
    let mut z0 = Vec::with_capacity(total);
    let mut z1 = Vec::with_capacity(total);
    let mut file_ids = Vec::with_capacity(total);
    let mut gens = Vec::with_capacity(total);
    let mut node_ids = Vec::with_capacity(total);

    let mut heap = BinaryHeap::<KeyHead>::with_capacity(segs.len());
    for (si, seg) in segs.iter().enumerate() {
        if seg.is_empty() {
            continue;
        }
        let key = seg.key_at(0);
        heap.push(KeyHead {
            key,
            seg: si,
            idx: 0,
        });
    }

    while let Some(item) = heap.pop() {
        let seg = &segs[item.seg];
        let occ = seg.occ_at(item.idx);
        if ft.is_occ_alive(occ.file_id, occ.r#gen) {
            z0.push(item.key.z0);
            z1.push(item.key.z1);
            file_ids.push(occ.file_id);
            gens.push(occ.r#gen);
            node_ids.push(occ.node_id);
        }

        let next = item.idx + 1;
        if next < seg.len() {
            let key = seg.key_at(next);
            heap.push(KeyHead {
                key,
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
