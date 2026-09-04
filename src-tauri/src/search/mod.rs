//! 局面での横断検索。
//!
//! 段は types → position → store → read → index → {cache, project_manager,
//! query_service} → build → state → commands。現在値は `tests/layering.rs` の
//! `LAYERS` が持つ。

pub mod build;
pub mod cache;
pub mod commands;
pub mod index;
pub mod position;
pub mod project_manager;
pub mod query_service;
pub mod read;
pub mod state;
pub mod store;
#[cfg(test)]
pub(crate) mod test_kifu;
pub mod types;
