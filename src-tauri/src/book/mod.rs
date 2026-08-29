//! 定跡を開いて局面から候補手を引く土台。
//!
//! 形式ごとの差は [`reader::BookReader`] の裏に閉じ、開いた定跡は
//! [`session::BookState`] がハンドルで束ねる。

pub mod error;
pub mod reader;
pub mod session;
pub mod sfen;
pub mod types;

pub use error::{BookError, BookErrorCode};
pub use reader::BookReader;
pub use session::BookState;
pub use types::{BookFormat, BookHandle, BookInfo, BookMove};
