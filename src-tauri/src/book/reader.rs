use crate::book::error::{BookError, BookErrorCode};
use crate::book::sfen::BookKey;
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
    /// 未収録の局面は空の `Vec` であって、エラーではない。
    fn lookup(&self, key: &BookKey) -> Result<Vec<BookMove>, BookError>;
}

/// 拡張子から形式を決めて reader を作る。
pub fn open_reader(path: &Path) -> Result<Box<dyn BookReader>, BookError> {
    let format = BookFormat::from_path(path)?;

    // `Path::is_file` は metadata が取れない理由を全て false に潰す。権限が無い
    // ファイルまで「見つからない」と案内されると、利用者は Finder でそれを見ながら
    // 探し直すことになり、権限を与えるという正しい復帰操作に辿り着けない。
    let meta = std::fs::metadata(path)
        .map_err(|e| BookError::from(e).with_path(path.to_string_lossy()))?;

    if !meta.is_file() {
        return Err(BookError::new(
            BookErrorCode::InvalidType,
            "定跡ファイルではないものが指定されている",
        )
        .with_path(path.to_string_lossy()));
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

    /// ディレクトリは存在するので NotFound ではない。「見つからない」と言われると
    /// 利用者は探し直してしまう。
    #[test]
    fn reports_a_directory_as_a_wrong_kind() {
        let dir = std::env::temp_dir().join("obs-shogi-book-open-reader-test.db");
        std::fs::create_dir_all(&dir).expect("テスト用のディレクトリを作れない");

        let result = open_reader(&dir);
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        let Err(err) = result else {
            panic!("ディレクトリを定跡として開けてしまった");
        };
        assert_eq!(err.code, BookErrorCode::InvalidType);
    }
}
