use crate::book::error::{BookError, BookErrorCode};
use crate::book::types::{BookFormat, BookMove};
use std::path::Path;

/// 形式ごとの定跡の読み手。
///
/// 開いたあとに必要なのは「この局面の候補手」と「何局面あるか」だけなので、
/// 形式差（テキスト / 固定長バイナリ / on-the-fly）はこの裏に閉じる。
pub trait BookReader: Send + Sync {
    fn format(&self) -> BookFormat;

    /// 収録局面数。
    fn position_count(&self) -> u64;

    /// 局面の候補手を、定跡に書かれている順で返す。
    ///
    /// `key` は [`crate::book::sfen::normalize_sfen`] を通したもの。生の SFEN を
    /// 渡すと手数の違いで引けなくなる。未収録の局面は空の `Vec` であって、エラーではない。
    fn lookup(&self, key: &str) -> Result<Vec<BookMove>, BookError>;
}

/// 拡張子から形式を決めて reader を作る。
pub fn open_reader(path: &Path) -> Result<Box<dyn BookReader>, BookError> {
    let format = BookFormat::from_path(path)?;

    if !path.is_file() {
        return Err(
            BookError::new(BookErrorCode::NotFound, "定跡ファイルが見つからない")
                .with_path(path.to_string_lossy()),
        );
    }

    Err(BookError::new(
        BookErrorCode::UnsupportedFormat,
        format!("{format:?} の reader をまだ持っていない"),
    )
    .with_path(path.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// `Box<dyn BookReader>` は Debug ではないので `unwrap_err` が使えない。
    fn open_err(path: &str) -> BookError {
        let Err(err) = open_reader(&PathBuf::from(path)) else {
            panic!("reader を持たない形式なのに open に成功した: {path}");
        };
        err
    }

    /// 形式の判別はファイルの実在より先。存在しない `.txt` は NotFound ではなく
    /// UnknownExtension になる。
    #[test]
    fn reports_the_extension_before_looking_at_the_file_system() {
        assert_eq!(
            open_err("/nonexistent/book.txt").code,
            BookErrorCode::UnknownExtension
        );
    }

    #[test]
    fn reports_a_missing_file() {
        let err = open_err("/nonexistent/book.db");
        assert_eq!(err.code, BookErrorCode::NotFound);
        assert_eq!(err.path.as_deref(), Some("/nonexistent/book.db"));
    }
}
