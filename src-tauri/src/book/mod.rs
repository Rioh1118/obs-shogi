//! 定跡を開いて局面から候補手を引く土台。
//!
//! 形式ごとの差は `BookReader`（crate 内）の裏に閉じ、開いた定跡は [`BookState`] が
//! ハンドルで束ねる。
//!
//! 説明は「型名から読めないもの」にだけ付ける。`BookInfo::handle` のように
//! 名前と型で決まるものは書かない。書く / 書かないが混ざると、次に足す人が迷う。
//!
//! サブモジュールは private にしてあり、外から使えるのはここに並んでいるものだけ。
//! `BookReader` も `BookState` の操作も `pub(crate)` なので、定跡を開く経路は
//! `open_book` コマンドしかない。形式ごとの reader を足すときも、この境界を
//! 越えて reader を直に作れるようにしないこと。

mod api;
mod error;
mod open;
mod reader;
mod session;
mod sfen;
mod types;

pub use api::{
    close_all_books, close_book, get_book_info, list_books, lookup_book_moves, open_book,
};
pub use error::{BookError, BookErrorCode};
pub use session::BookState;
pub use types::{
    BookFormat, BookHandle, BookHandleInput, BookInfo, BookMove, LookupBookMovesInput,
    OpenBookInput,
};
