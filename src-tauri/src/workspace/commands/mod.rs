//! Tauri コマンドの入口。
//!
//! **root 配下の検査はここで呼ぶ。** 下の段へ下ろすと、検査を呼び忘れたコマンドが
//! 静的には見えなくなる（`tests/root_guard.rs` は `#[command]` の本体を読む）。
//!
//! ここが持つのは入口の検証だけ。何をどの形式で綴るか、どう歩くかは下の段。

pub mod entry;
pub mod kifu;
pub mod mv;
pub mod tree;
