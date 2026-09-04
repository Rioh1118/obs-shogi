//! 索引をメモリに置く層の窓口。
//!
//! 役は2つに分けてある。
//!
//! | ファイル | 何を持つか | 何で変わるか |
//! | --- | --- | --- |
//! | [`snapshot`](super::snapshot) | 索引の値と、次の値を作る純関数 | 索引に何が入るか |
//! | [`snapshot_cell`](super::snapshot_cell) | 差し替えの器。中身を知らない | 並行性の都合 |
//!
//! **`IndexStore` は器をそのまま公開しない。** 素の `replace` を出すと
//! 「中身を捨てて `Ready` を名乗る」が1式で書けてしまう。置ける形は
//! [`IndexStore::restart`] と [`IndexStore::install_restored`] の2つだけ。
//!
//! **遷移の規則を持つ場所は無い。** どの段からどの段へ動いてよいかは
//! 呼び手（`search/commands.rs` / `build.rs` / `project_manager.rs`）に散っている。

use std::sync::Arc;

use crate::search::store::bucket::BucketEntries;
use crate::search::store::file_table::FileTable;
use crate::search::store::node_table::NodeTables;
use crate::search::store::snapshot::{IndexSnapshot, IndexState, Restart};
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
    pub fn install_restored(
        &self,
        state: IndexState,
        file_table: FileTable,
        node_tables: NodeTables,
        entries: BucketEntries,
    ) {
        self.cell.replace(IndexSnapshot::restored(
            state,
            file_table,
            node_tables,
            entries,
        ));
    }
}
