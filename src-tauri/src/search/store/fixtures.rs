//! テストの素材。**`store/` の中からだけ使う。**
//!
//! 本番が作る形を通すことが目的なので、桶は `bucketize_entries` を通す。
//! 手で組むと桶の中身が常に1件になり、`Segment::new_sorted` の昇順の検査も
//! `range_by_key` の二分探索も一度も効かない。

use std::sync::Arc;

use crate::search::position::position_key::PositionKey;
use crate::search::store::bucket::{bucketize_entries, FileBucketEntries};
use crate::search::store::node_table::{NodeTableArc, NodeTableBuilder};
use crate::search::types::{FileEntry, Occurrence};

pub(super) fn key_of(z0: u64) -> PositionKey {
    PositionKey { z0, z1: 0 }
}

pub(super) fn occ_of(file_id: u32, node_id: u32) -> Occurrence {
    Occurrence {
        file_id,
        r#gen: 1,
        node_id,
    }
}

pub(super) fn entry_of(file_id: u32) -> FileEntry {
    FileEntry {
        file_id,
        path: format!("{file_id}.kif"),
        deleted: false,
        r#gen: 1,
    }
}

pub(super) fn node_table_of(nodes: u32) -> NodeTableArc {
    let mut b = NodeTableBuilder::new();
    for n in 0..nodes {
        b.push_node(n, &[]);
    }
    Arc::new(b.finish())
}

/// 1ファイル分の取り込みの素材。
///
/// **本番の口（`bucketize_entries`）を通す。** 桶に直接 push すると
/// 中身が常に1件になり、`Segment::new_sorted` の昇順の検査も
/// `range_by_key` の二分探索も一度も効かない。
pub(super) fn file_with(file_id: u32, keys: &[(PositionKey, u32)]) -> FileBucketEntries {
    let entries: Vec<(PositionKey, Occurrence)> = keys
        .iter()
        .map(|(k, node_id)| (*k, occ_of(file_id, *node_id)))
        .collect();
    let max_node = keys.iter().map(|(_, n)| *n).max().unwrap_or(0);
    (
        entry_of(file_id),
        node_table_of(max_node + 1),
        bucketize_entries(entries),
    )
}

/// 1鍵1出現の素材。
pub(super) fn one_file(file_id: u32, key: PositionKey, node_id: u32) -> FileBucketEntries {
    file_with(file_id, &[(key, node_id)])
}
