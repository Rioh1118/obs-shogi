//! アプリの設定ディレクトリに置く JSON。
//!
//! **3つとも同じ形をしている** — `app_config_dir` の下にファイルを1つ置き、
//! 無ければ既定値、書くときは原子的に置き換える。別のスライスに分けていると、
//! 片方だけ直した違いが「どの設定がどう壊れるか」の差になって出る。

pub mod app;
pub mod commands;
pub mod presets;
pub mod study;
