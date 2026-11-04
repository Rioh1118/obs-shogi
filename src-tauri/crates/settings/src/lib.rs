//! アプリの設定ディレクトリ（`app_config_dir`）に置く JSON の形と読み書き。
//!
//! どのファイルも `app_config_dir` の直下に1つずつ置き、無ければ既定値で読み、書くときは
//! 原子的に置き換える。1つの crate にまとめてあるのは、片方だけ直した違いが
//! 「どの設定がどう壊れるか」の差になって出るため。
//!
//! 壊れたファイルの扱いはファイルごとに違う。
//!
//! - `app.json`（[`app`]）は `Err` を返す。画面は [`app::back_up_broken`] で退避してから書き直す
//! - 研究局面（[`study`]）は `Err` を返す。画面は読めるまで書かない
//! - プリセット（[`presets`]）は別の名前へ移して空から始める。移せなければ読み取り専用で開く
//! - 更新の告知の記憶（[`updater`]）は既定値を返す。理由はそちらのモジュール doc

pub mod app;
pub mod commands;
pub mod presets;
pub mod study;
pub mod updater;
