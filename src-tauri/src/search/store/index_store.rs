//! 索引をメモリに置く層の窓口。
//!
//! 役は2つに分けてある。
//!
//! | ファイル | 何を持つか | 何で変わるか |
//! | --- | --- | --- |
//! | [`snapshot`](super::snapshot) | 索引の値と、次の値を作る純関数 | 索引に何が入るか |
//! | [`snapshot_cell`](super::snapshot_cell) | 差し替えの器。中身を知らない | 並行性の都合 |
//!
//! 使う側はこう書く。
//!
//! ```ignore
//! let snap = store.snapshot();                    // 持ち出して読む
//! store.update(|s| s.with_files(items));          // 次の値を作って置く
//! store.replace(IndexSnapshot::empty_with(Building));
//! ```
//!
//! **遷移の規則を持つ場所は無い。** どの状態からどの状態へ動いてよいかは
//! 呼び手（`search/commands.rs` / `build.rs` / `project_manager.rs`）に散っている。

use crate::search::store::snapshot::IndexSnapshot;
use crate::search::store::snapshot_cell::SnapshotCell;

/// 索引を1つ持つ升。
pub type IndexStore = SnapshotCell<IndexSnapshot>;
