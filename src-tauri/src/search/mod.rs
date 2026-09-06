//! 局面での横断検索。
//!
//! 段は message → types → position → store → read → index → {cache, project_manager,
//! query_service} → build → state → commands。**これを見ている機械は無い**（`tests/layering.rs` が
//! 走査するのは `src/engine` だけ。#399）。
//!
//! **逆向きが1本ある。** `read/kifu_reader.rs` のテストが `index::index_builder` を引く
//! （組み立ての側からも `says_nothing` の判定を見るため）。#399 を閉じるときは、
//! テストを `index/` へ移すか、走査から `#[cfg(test)]` を外すかを先に決めること。

pub mod build;
pub mod cache;
pub mod commands;
pub mod index;
pub(crate) mod message;
pub mod position;
pub mod project_manager;
pub mod query_service;
pub mod read;
pub mod state;
pub mod store;
pub mod types;
