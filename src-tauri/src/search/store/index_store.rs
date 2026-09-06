//! 索引をメモリに置く層の窓口。
//!
//! 役は2つに分けてある。
//!
//! | ファイル | 何を持つか | 何で変わるか |
//! | --- | --- | --- |
//! | [`snapshot`](super::snapshot) | 索引の値と、次の値を作る純関数 | 索引に何が入るか |
//! | [`snapshot_cell`](super::snapshot_cell) | 差し替えの器。中身を知らない | 並行性の都合 |
//!
//! **`IndexStore` は器の `replace` を出さない。** 段を捨てる口は
//! [`IndexStore::restart`] だけで、そこは [`Restart`] の2つに絞ってある。
//!
//! **絞りきってはいない。** `IndexSnapshot` の欄は4つとも `pub` なので、
//! `update(|_| IndexSnapshot { state: Ready, ..Default::default() })` ——
//! **空なのに `Ready` を名乗る索引** —— が構造体リテラルから書ける
//! （`query_service` の `stale` が偽になり、空の結果が新鮮として並ぶ）。
//!
//! **欄を非公開にする道は使えない。** `benches/search_bench.rs` が
//! 構造体リテラルで組んでいる。塞ぐなら bench 向けに名前の付いた口を
//! 1つ用意して、そのうえで欄を閉じることになる。
//!
//! **遷移の規則を持つ場所は無い。** どの段からどの段へ動いてよいかは
//! 呼び手（`search/commands.rs` / `build.rs` / `project_manager.rs`）に散っている。

use std::sync::Arc;

use crate::search::store::bucket::BucketEntries;
use crate::search::store::file_table::FileTable;
use crate::search::store::node_table::NodeTables;
use crate::search::store::snapshot::{IndexSnapshot, Restart};
use crate::search::store::snapshot_cell::SnapshotCell;

/// 索引を1つ持つ升。
#[derive(Debug, Default)]
pub struct IndexStore {
    cell: SnapshotCell<IndexSnapshot>,
}

impl IndexStore {
    /// いまの索引を持ち出す。**持ち出した後の書き換えは見えない。**
    pub fn snapshot(&self) -> Arc<IndexSnapshot> {
        self.cell.snapshot()
    }

    /// いまの索引から次の索引を作って置く。
    ///
    /// `f` は書き込みロックの中で走る。長さがそのまま検索の待ちになる
    /// （[`SnapshotCell::update`](super::snapshot_cell::SnapshotCell::update)）。
    pub fn update(&self, f: impl FnOnce(&IndexSnapshot) -> IndexSnapshot) {
        self.cell.update(f);
    }

    /// **中身を捨てて作り直しに入る。** 段は捨ててよい2つに限る。
    pub fn restart(&self, at: Restart) {
        self.cell.replace(IndexSnapshot::restarting(at));
    }

    /// キャッシュから読み戻した中身を丸ごと置く。
    ///
    /// **段は `Updating` に決め打つ。** `Ready` を先に出すと
    /// `stale = false` の結果が古い索引を見る（理由は `search/commands.rs` の
    /// `open_project`）。
    ///
    /// **呼び手は、このあと `Ready` へ上げる責任を負う。**
    /// 上げないと `search/query_service.rs` の `stale` が真のまま残り、
    /// 検索の結果に「インデックス更新待ち」が付き続ける。
    /// いまの呼び手は `search/commands.rs` の `open_project` で、
    /// 差分が0でも無条件に上げている。
    pub fn install_restored(
        &self,
        file_table: FileTable,
        node_tables: NodeTables,
        entries: BucketEntries,
    ) {
        self.cell
            .replace(IndexSnapshot::restored(file_table, node_tables, entries));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::store::fixtures::{key_of, one_file};
    use crate::search::store::snapshot::IndexState;

    /// **作り直しに入ると、いま持っている索引が捨てられる。**
    ///
    /// 捨てているのは `IndexStore::restart` の側なので、器を通して見る。
    #[test]
    fn restarting_the_store_throws_the_current_index_away() {
        let k = key_of(0x6600_0000_0000_0001);
        let store = IndexStore::default();
        store.update(|s| s.with_files(vec![one_file(1, k, 0)]));
        assert_eq!(store.snapshot().search_occurrences_by_key(k).len(), 1);

        store.restart(Restart::Building);

        assert!(store.snapshot().search_occurrences_by_key(k).is_empty());
        assert!(store.snapshot().node_tables.get(1).is_none());
    }

    /// **復元した索引は `Updating` を名乗る。**
    ///
    /// 段を選ばせないのは、`Ready` を先に出すと `stale = false` の結果が
    /// 古い索引を見るため（`search/commands.rs` の `open_project`）。
    #[test]
    fn an_installed_restore_says_it_is_still_updating() {
        use crate::search::store::bucket::empty_buckets;

        let store = IndexStore::default();
        store.install_restored(FileTable::default(), NodeTables::default(), empty_buckets());

        assert_eq!(store.snapshot().state, IndexState::Updating);
    }
}
