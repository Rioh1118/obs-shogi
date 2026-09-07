//! テストの素材。**`store/` の中からだけ使う。**
//!
//! 桶は本番と同じ口（`bucketize_entries`）に振らせる。
//!
//! **昇順の検査を効かせたいテストは、同じ桶に落ちる鍵を複数渡すこと**
//! （上位8ビットが同じ鍵。例は `snapshot.rs` の
//! `several_keys_in_one_bucket_are_ordered_by_the_maker`）。
//! 1鍵しか渡さないと桶の中身が1件になり、`Segment::new_sorted` の昇順の検査も
//! `range_by_key` の二分探索も効かない。

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
        indexed: true,
        r#gen: 1,
    }
}

/// `node_count` 個の節を持つ表。**引数は識別子でなく個数。**
pub(super) fn node_table_with(node_count: u32) -> NodeTableArc {
    let mut b = NodeTableBuilder::new();
    for n in 0..node_count {
        b.push_node(n, &[]);
    }
    Arc::new(b.finish())
}

/// 1ファイル分の取り込みの素材。桶は `bucketize_entries` に振らせる。
pub(super) fn file_with(file_id: u32, keys: &[(PositionKey, u32)]) -> FileBucketEntries {
    let entries: Vec<(PositionKey, Occurrence)> = keys
        .iter()
        .map(|(k, node_id)| (*k, occ_of(file_id, *node_id)))
        .collect();
    let max_node = keys.iter().map(|(_, n)| *n).max().unwrap_or(0);
    (
        entry_of(file_id),
        node_table_with(max_node + 1),
        bucketize_entries(entries),
    )
}

/// 1鍵1出現の素材。
pub(super) fn one_file(file_id: u32, key: PositionKey, node_id: u32) -> FileBucketEntries {
    file_with(file_id, &[(key, node_id)])
}

/// この `file_id` たちだけが生きているファイル表。
pub(super) fn alive_of(ids: &[u32]) -> crate::search::store::file_table::FileTable {
    let mut ft = crate::search::store::file_table::FileTable::default();
    for id in ids {
        ft.upsert(entry_of(*id));
    }
    ft
}
