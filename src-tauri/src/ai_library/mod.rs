//! 利用者が選んだ AI の置き場（`ai_root`）。
//!
//! **ワークスペースとは別の場所。** root の関門は掛からないので、
//! ここへ作るものの名前は `fs::path` の規則で自分で弾く。

pub mod commands;
pub mod dir;
pub mod engines;
pub mod profile;
pub mod scan;
