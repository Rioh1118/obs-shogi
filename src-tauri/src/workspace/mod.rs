//! 利用者が選んだ棋譜のワークスペース。
//!
//! **ここが「どこが root か」を知る唯一の枝。** 名前とパスの判定そのものは
//! `fs` にあり、そちらは設定を読まない。

pub mod commands;
pub mod guard;
pub mod record;
pub mod tree;
pub mod types;
