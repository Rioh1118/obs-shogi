use std::sync::Arc;

use crate::search::position::position_key::PositionKey;
use crate::search::types::Occurrence;

pub type SegmentArc = Arc<Segment>;

/// bucket 内の不変セグメント (SoA レイアウト)。
///
/// (z0, z1) が binary search のホット列なので並列 Vec にする。Occurrence 列は
/// hit 後にしか参照しないため、binary search 中の L1 を z0/z1 が占有できる。
#[derive(Debug, Default)]
pub struct Segment {
    z0: Vec<u64>,
    z1: Vec<u64>,
    file_ids: Vec<u32>,
    gens: Vec<u32>,
    node_ids: Vec<u32>,
}

impl Segment {
    /// `entries` は (z0,z1) 昇順ソート済みであること。
    pub fn new_sorted(entries: Vec<(PositionKey, Occurrence)>) -> Self {
        let n = entries.len();
        let mut z0 = Vec::with_capacity(n);
        let mut z1 = Vec::with_capacity(n);
        let mut file_ids = Vec::with_capacity(n);
        let mut gens = Vec::with_capacity(n);
        let mut node_ids = Vec::with_capacity(n);

        for (k, occ) in entries {
            z0.push(k.z0);
            z1.push(k.z1);
            file_ids.push(occ.file_id);
            gens.push(occ.gen);
            node_ids.push(occ.node_id);
        }

        Self {
            z0,
            z1,
            file_ids,
            gens,
            node_ids,
        }
    }

    pub fn from_soa(
        z0: Vec<u64>,
        z1: Vec<u64>,
        file_ids: Vec<u32>,
        gens: Vec<u32>,
        node_ids: Vec<u32>,
    ) -> Self {
        debug_assert_eq!(z0.len(), z1.len());
        debug_assert_eq!(z0.len(), file_ids.len());
        debug_assert_eq!(z0.len(), gens.len());
        debug_assert_eq!(z0.len(), node_ids.len());
        Self {
            z0,
            z1,
            file_ids,
            gens,
            node_ids,
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.z0.is_empty()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.z0.len()
    }

    /// `idx` の鍵と `key` を比べる。**並びの規約は `PositionKey` の `Ord`。**
    ///
    /// 列に割って持っているのは二分探索のためで、順序まで自前で組むと
    /// 並べる側（`store/bucket.rs`）と食い違ったときに黙って外す。
    #[inline]
    fn cmp_at(&self, idx: usize, key: PositionKey) -> std::cmp::Ordering {
        PositionKey {
            z0: self.z0[idx],
            z1: self.z1[idx],
        }
        .cmp(&key)
    }

    fn lower_bound(&self, key: PositionKey) -> usize {
        let mut lo = 0usize;
        let mut hi = self.z0.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.cmp_at(mid, key).is_lt() {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    fn upper_bound(&self, key: PositionKey) -> usize {
        let mut lo = 0usize;
        let mut hi = self.z0.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.cmp_at(mid, key).is_gt() {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        lo
    }

    /// key に完全一致する `[lo, hi)` 半開区間。
    pub fn range_by_key(&self, key: PositionKey) -> (usize, usize) {
        let lo = self.lower_bound(key);
        if lo >= self.z0.len() || self.cmp_at(lo, key).is_ne() {
            return (lo, lo);
        }
        let hi = self.upper_bound(key);
        (lo, hi)
    }

    #[inline]
    pub fn occ_at(&self, idx: usize) -> Occurrence {
        Occurrence {
            file_id: self.file_ids[idx],
            gen: self.gens[idx],
            node_id: self.node_ids[idx],
        }
    }

    #[inline]
    pub fn key_at(&self, idx: usize) -> PositionKey {
        PositionKey {
            z0: self.z0[idx],
            z1: self.z1[idx],
        }
    }

    pub fn iter_entries(&self) -> impl Iterator<Item = (PositionKey, Occurrence)> + '_ {
        (0..self.z0.len()).map(|i| (self.key_at(i), self.occ_at(i)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::store::bucket::bucketize_entries;

    fn occ(node_id: u32) -> Occurrence {
        Occurrence {
            file_id: 1,
            r#gen: 1,
            node_id,
        }
    }

    /// **並べる側と探す側が同じ順序を使う。**
    ///
    /// 桶へ振り分けて整列するのは `store/bucket.rs`、そこから塊を作って
    /// 二分探索するのはここ。どちらも `PositionKey` の `Ord` を通るので
    /// 一致するはずだが、片方が自前で組み直すと**黙って外す** — 検索が0件に
    /// なるか別の局面を返すかで、エラーも警告も出ない。
    ///
    /// `z0` を揃えて `z1` だけが違う鍵を混ぜてある。上位だけで比べると
    /// この組が見分けられなくなる。
    #[test]
    fn every_key_that_was_sorted_in_can_be_found_again() {
        let entries: Vec<(PositionKey, Occurrence)> = vec![
            (PositionKey { z0: 7, z1: 300 }, occ(0)),
            (PositionKey { z0: 7, z1: 100 }, occ(1)),
            (PositionKey { z0: 7, z1: 200 }, occ(2)),
            (PositionKey { z0: 3, z1: 999 }, occ(3)),
            (PositionKey { z0: 9, z1: 0 }, occ(4)),
        ];

        // 本番と同じ経路で並べる
        let buckets = bucketize_entries(entries.clone());
        let sorted: Vec<(PositionKey, Occurrence)> = buckets.into_iter().flatten().collect();
        let seg = Segment::new_sorted(sorted);

        for (key, o) in &entries {
            let (lo, hi) = seg.range_by_key(*key);
            assert!(lo < hi, "並べた鍵が引けない: {key:?}");

            let found: Vec<u32> = (lo..hi).map(|i| seg.occ_at(i).node_id).collect();
            assert!(
                found.contains(&o.node_id),
                "別の鍵の場所を指している: {key:?} → {found:?}"
            );
        }

        // 入れていない鍵は引けない
        let (lo, hi) = seg.range_by_key(PositionKey { z0: 7, z1: 150 });
        assert_eq!(lo, hi, "入れていない鍵が引けた");
    }
}
