//! 定跡を開いて局面から候補手を引く土台。
//!
//! 形式ごとの差は [`BookReader`] の裏に閉じ、開いた定跡は [`BookState`] が
//! ハンドルで束ねる。
//!
//! サブモジュールは private にしてある。外から使えるのはここに並んでいるものだけで、
//! 定跡を開く唯一の経路は `open_book` コマンド（内部では `reader::open_reader`）。
//! 形式ごとの reader を足すときも、`BookState` を通さず reader を直に作る経路を
//! 外に出さないこと。

mod api;
mod error;
mod reader;
mod session;
mod sfen;
mod types;

pub use api::{
    close_all_books, close_book, get_book_info, list_books, lookup_book_moves, open_book,
};
pub use error::{BookError, BookErrorCode};
pub use reader::BookReader;
pub use session::{BookSession, BookState};
pub use types::{BookFormat, BookHandle, BookInfo, BookMove};
