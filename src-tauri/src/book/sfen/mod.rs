//! **段の宣言だけを置く。** 実装は下の段が持つ（ADR-0009 決定4）。

mod board;
mod counts;
mod hands;
mod key;

pub(crate) use key::{to_book_key, to_book_key_in_file, BookKey};
