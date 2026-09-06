//! 定跡を開いて局面から候補手を引く土台。
//!
//! 形式ごとの差は `BookReader`（crate 内）の裏に閉じ、開いた定跡は
//! `session::BookState` がハンドルで束ねる。
//!
//! 説明は「型名から読めないもの」にだけ付ける。`BookInfo::handle` のように
//! 名前と型で決まるものは書かない。書く / 書かないが混ざると、次に足す人が迷う。
//!
//! 段は types → error → sfen → reader → yaneuraou_db → formats → open →
//! session → commands。**これを見ている機械は無い**
//! （`tests/layering.rs` が走査するのは `src/engine` だけ。#399）。
//!
//! **定跡を開く経路は `open_book` コマンドだけ。** それを保っているのは
//! `pub(crate)` ではなく、**`open` と `reader` が private であること**
//! （`pub(crate)` は crate 全体に見えるので、それ単体では何も止めない）。
//! `mod open;` を `pub mod open;` に1語変えるだけでこの宣言は偽になる ——
//! **止める機械は無い。** 形式ごとの reader を足すときも、
//! この境界を越えて reader を直に作れるようにしないこと。
//!
//! `commands` と `session` が public なのは ADR-0009 決定3 と決定4 ——
//! コマンドは各スライスの `commands` 段にだけ置き、`lib.rs` はそこを
//! 完全修飾で名指す。再エクスポートを挟むと、登録漏れを目で探すことになる。

pub mod commands;
mod error;
mod formats;
mod open;
mod reader;
pub mod session;
mod sfen;
mod types;
mod yaneuraou_db;

// **再輸出を置かない**（ADR-0009 決定4）。`pub use` の facade があると、
// 段の名前を通らずに到達できる経路ができ、段の表が記述でなくなる。
//
// コマンドの署名に出る型（`BookError` / `BookInfo` / `BookMove` /
// `OpenBookInput` ほか）は `pub` のままだが、置いてある段
// （`error` / `types`）が private なので外から名前を引けない。
// 名前が要るなら、その段を `pub mod` にすること ——
// どの段に居るかが呼び出し側から読める形にする。
