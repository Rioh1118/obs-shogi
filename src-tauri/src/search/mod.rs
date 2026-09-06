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

/// 進捗を出す間隔。**線に出る形ではないので `types` には置かない。**
///
/// **経路ごとに変えない。** 同じ進捗バーへ全件構築と差分更新の両方が流すので、
/// 片方だけ間引くと、同じ件数の変更でも経路によって画面の滑らかさが違う。
///
/// 間引かないと、フォルダを1つ移しただけで数千件の直列化と IPC が
/// 途切れなく走り、tokio のワーカーを1本占有する。
pub const EMIT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
