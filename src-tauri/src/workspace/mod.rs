//! 利用者が選んだ棋譜のワークスペースの中で、ファイルとフォルダを扱う。
//!
//! パスの判定のために設定上の root を読むのは `guard` だけ。名前とパスの判定そのものは
//! `fs` crate にあり、そちらは設定を読まない。

pub mod commands;
pub mod guard;
pub mod record;
pub mod tree;
pub mod types;
