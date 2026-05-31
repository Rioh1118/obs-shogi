use std::sync::Arc;

use super::{position_key::PositionKey, types::Occurrence};

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

    #[inline]
    fn cmp_at(&self, idx: usize, key: PositionKey) -> std::cmp::Ordering {
        (self.z0[idx], self.z1[idx]).cmp(&(key.z0, key.z1))
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
