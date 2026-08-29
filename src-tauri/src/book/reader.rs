use crate::book::error::{BookError, BookErrorCode};
use crate::book::sfen::BookKey;
use crate::book::types::BookFormat;
use crate::book::types::BookMove;
use std::path::Path;

/// 形式ごとの定跡の読み手。
///
/// 開いたあとに必要なのは「この局面の候補手」と「何局面あるか」だけなので、
/// 形式差（テキスト / 固定長バイナリ / on-the-fly）はこの裏に閉じる。
///
/// 実装が守ること:
///
/// - **失敗を空の結果に丸めない。** 読めなかったときは `Io`、書式が壊れている
///   ときは `InvalidContent` を返す。空の `Vec` は「未収録」だけを意味する。
///   外付けドライブを抜かれた定跡が「全局面が定跡に無い」に見えると、利用者は
///   定跡が死んだことに気づけない
/// - **壊れた内容で panic しない。** 途中で切れたファイルは固定長レコードの
///   境界を跨ぐので、範囲検査をして `InvalidContent` を返す。panic すると
///   コマンド境界では `Unknown` にしかならず、フロントは「壊れている」という
///   復帰導線を出せない
/// - io の失敗は [`BookError::from_io`] でパスを添えて返す
pub(crate) trait BookReader: Send + Sync {
    /// 収録局面数。意味は [`crate::book::BookInfo::position_count`] と同じ。
    fn position_count(&self) -> Option<u64>;

    /// 局面の候補手を、定跡に書かれている順で返す。
    ///
    /// 未収録の局面は空の `Vec` であって、エラーではない。
    fn lookup(&self, key: &BookKey) -> Result<Vec<BookMove>, BookError>;
}

/// 拡張子から形式を決めて reader を作る。
///
/// `path` は canonicalize 済みのものを渡すこと。ここで解決を任せると、
/// 呼び出し側が形式を検査した先と実際に開くファイルが別物になりうる。
///
/// 検査の順序は、拡張子 → ファイルの実在。形式が分からないものは、たとえ
/// 実在しても開きようが無いので先に弾く。存在しない `.txt` は `NotFound` ではなく
/// `UnknownExtension` になる。
///
/// 返るもの:
///
/// - `UnknownExtension` — 拡張子が `.db` / `.bin` / `.sbk` / `.ybb` のどれでもない
/// - `NotFound` / `PermissionDenied` / `Io` — metadata が取れない
/// - `InvalidType` — ディレクトリなどファイルでないもの
/// - `UnsupportedFormat` — 形式は分かるが reader をまだ持っていない
///
// TODO(#91): やねうら王テキスト定跡 (.db) の reader を足すまで、この関数は
// 成功する経路を持たない。#[tauri::command] の open_book は必ず失敗する。
pub(crate) fn open_reader(path: &Path) -> Result<Box<dyn BookReader>, BookError> {
    let format = BookFormat::from_path(path)?;

    // `Path::is_file` は metadata が取れない理由を全て false に潰す。権限が無い
    // ファイルまで「見つからない」と案内されると、利用者は Finder でそれを見ながら
    // 探し直すことになり、権限を与えるという正しい復帰操作に辿り着けない。
    let meta =
        std::fs::metadata(path).map_err(|e| BookError::from_io(e, path.to_string_lossy()))?;

    if !meta.is_file() {
        return Err(BookError::new(
            BookErrorCode::InvalidType,
            "定跡ファイルではないものが指定されている",
        )
        .with_path(path.to_string_lossy()));
    }

    Err(BookError::new(
        BookErrorCode::UnsupportedFormat,
        format!(
            "{}はまだ開けない。他の形式もまだ開けないので、別のファイルを試しても同じ結果になる",
            format.display_name()
        ),
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
            open_err("/nonexistent/book.txt").code(),
            BookErrorCode::UnknownExtension
        );
    }

    #[test]
    fn reports_a_missing_file() {
        let err = open_err("/nonexistent/book.db");
        assert_eq!(err.code(), BookErrorCode::NotFound);
        assert_eq!(err.path(), Some("/nonexistent/book.db"));
    }

    /// `open_reader` は成功経路を持たないので、これが今この機能を触った利用者に
    /// 届く唯一の文面。種別だけを見るテストでは、案内を空にしても緑のまま通る。
    #[test]
    fn an_unsupported_format_tells_the_user_what_to_expect() {
        let file = std::env::temp_dir().join("obs-shogi-book-unsupported.db");
        std::fs::write(&file, b"").expect("テスト用のファイルを作れない");

        let result = open_reader(&file);
        std::fs::remove_file(&file).expect("テスト用のファイルを消せない");

        let Err(err) = result else {
            panic!("reader を持たない形式なのに開けてしまった");
        };
        assert_eq!(err.code(), BookErrorCode::UnsupportedFormat);
        assert!(
            err.message()
                .contains(BookFormat::YaneuraouDb.display_name()),
            "形式名が出ていない: {}",
            err.message()
        );
        assert!(
            err.message().contains("同じ結果になる"),
            "他を試しても無駄だと書かれていない: {}",
            err.message()
        );
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
        assert_eq!(err.code(), BookErrorCode::InvalidType);
    }
}
