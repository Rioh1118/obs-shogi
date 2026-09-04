//! 局面での横断検索。
//!
//! 段は types → position → store → read → index → {cache, project_manager,
//! query_service} → build → state → commands。**これを見ている機械は無い**（`tests/layering.rs` が
//! 走査するのは `src/engine` だけ。#399）。

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
pub mod types;
