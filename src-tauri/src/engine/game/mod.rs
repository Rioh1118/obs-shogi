//! 対局。
//!
//! フロントに出す語彙は「対局者・持ち時間・手番・決まった手・終局」だけで、
//! `readyok` / `usiok` / `position` / `go` はこの中に閉じている。
//! 責任の切れ目は [`session`] の冒頭。

pub mod clock;
pub mod manager;
pub mod search;
pub mod session;
pub mod types;
