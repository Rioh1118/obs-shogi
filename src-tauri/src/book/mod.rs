//! 定跡を開いて局面から候補手を引く土台。
//!
//! 形式ごとの差は `BookReader`（crate 内）の裏に閉じ、開いた定跡は [`BookState`] が
//! ハンドルで束ねる。
//!
//! 説明は「型名から読めないもの」にだけ付ける。`BookInfo::handle` のように
//! 名前と型で決まるものは書かない。書く / 書かないが混ざると、次に足す人が迷う。
//!
//! **`commands` 以外のサブモジュールは private。** 外から使えるのはここに
//! 並んでいるものと、`commands` に居る6本だけ。`BookReader` も `BookState` の
//! 操作も `pub(crate)` なので、定跡を開く経路は `open_book` コマンドしかない。
//! 形式ごとの reader を足すときも、この境界を越えて reader を直に
//! 作れるようにしないこと。
//!
//! `commands` を public にしているのは ADR-0009 決定3 ——
//! コマンドは各スライスの `commands` 段にだけ置き、`lib.rs` はそこを
//! 完全修飾で名指す。再エクスポートを挟むと、登録漏れを目で探すことになる。

pub mod commands;
mod error;
mod formats;
mod open;
mod reader;
mod session;
mod sfen;
mod types;
mod yaneuraou_db;

// `BookError` はコマンドの `Err` 型なので `pub`。組み立てと読み取りは
// `pub(crate)` にしてある。外から「作れるが読めない」型にしないため。
// 種別で分岐させたくなったら、`code()` を上げるのと一緒に `BookErrorCode` も上げる。
pub use error::BookError;
pub use session::BookState;
pub use types::{
    BookFormat, BookHandle, BookHandleInput, BookInfo, BookMove, LookupBookMovesInput,
    OpenBookInput,
};
