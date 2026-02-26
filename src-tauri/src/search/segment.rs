use std::sync::Arc;

use super::{position_key::PositionKey, types::Occurrence};

pub type SegmentArc = Arc<Segment>;

/// bucket内の不変セグメント（PositionKeyでソート済み）
#[derive(Debug)]
pub struct Segment {
    entries: Vec<(PositionKey, Occurrence)>,
}

impl Segment {
    /// `entries` は `(k.z0,k.z1)` 昇順でソート済みであること
    pub fn new_sorted(entries: Vec<(PositionKey, Occurrence)>) -> Self {
        Self { entries }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    #[inline]
    pub fn entries(&self) -> &[(PositionKey, Occurrence)] {
        &self.entries
    }

    /// key に完全一致する範囲を返す（空スライスあり）
    pub fn range_by_key(&self, key: PositionKey) -> &[(PositionKey, Occurrence)] {
        let target = (key.z0, key.z1);

        // lower_bound: first index where entry_key >= target
        let lo = self.entries.partition_point(|(k, _)| (k.z0, k.z1) < target);

        // upper_bound: first index where entry_key > target
        let hi = self
            .entries
            .partition_point(|(k, _)| (k.z0, k.z1) <= target);

        &self.entries[lo..hi]
    }
}
