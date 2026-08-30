use crate::book::error::{BookError, BookErrorCode};
use crate::book::sfen::BookKey;
use crate::book::types::BookFormat;
use crate::book::types::BookMove;
use std::path::{Path, PathBuf};

/// 形式ごとの定跡の読み手。
///
/// 開いたあとに必要なのは「この局面の候補手」だけなので、形式差
/// （テキスト / 固定長バイナリ / on-the-fly）はこの裏に閉じる。
///
/// 収録局面数はここに置かない。開くときに1度決まる値で、開いたあとの
/// 問い合わせではないから。実装ごとに「毎回数えるのか、開くときに数えるのか」を
/// 判断させると、数え方の違いが trait の外から見えなくなる。
/// 数えるのは [`open_reader`] の中（blocking プールの中）で、結果は
/// [`OpenedBook::position_count`] に載せる。
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
    /// 局面の候補手を、定跡に書かれている順で返す。
    ///
    /// 未収録の局面は空の `Vec` であって、エラーではない。
    fn lookup(&self, key: &BookKey) -> Result<Vec<BookMove>, BookError>;
}

/// 開いた定跡ひとつぶんの材料。
///
/// 確定させる場所は2つに分かれる。`format` は `open` モジュールがパスを解決する
/// ときに決め、[`open_reader`] は受け取るだけ（決め直すと symlink をもう一度
/// たどることになる）。`position_count` は [`open_reader`] が数える。
///
/// どちらも reader ではなくここに持つのは、**`BookState::register` に
/// 問い合わせさせないため。** register は async ランタイム上で走るので、
/// ヘッダを読んで答える実装が入った瞬間に IO が async ワーカで走る。
/// 数えるのは blocking プールの中で1度だけ。
pub(crate) struct OpenedBook {
    pub(crate) path: PathBuf,
    pub(crate) format: BookFormat,
    pub(crate) position_count: Option<u64>,
    pub(crate) reader: Box<dyn BookReader>,
}

/// 実体のファイルを開いて reader を作る。
///
/// `path` は canonicalize 済み、`format` は**その綴りから決めた形式**を渡すこと。
/// ここで拡張子から決め直すと、呼び出し側が形式を検査した先と実際に開く
/// ファイルが別物になりうる（symlink を張り替えられる隙が空く）。
///
/// 返るもの:
///
/// - `NotFound` / `PermissionDenied` / `Io` — metadata が取れない
/// - `InvalidType` — ディレクトリなどファイルでないもの
/// - `InvalidContent` — 形式の中身が読めない
/// - `UnsupportedFormat` — 形式は分かるが reader をまだ持っていない
///
/// `NotFound` は、呼び出し側が解決を終えたあとに実体が消えた場合にだけ届く。
/// 選ぶ時点で存在しないパスは、解決の側が先に弾く。
pub(crate) fn open_reader(path: &Path, format: BookFormat) -> Result<OpenedBook, BookError> {
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

    // 読める形式が増えたら、ここに枝を足す。
    // 数え上げも reader の生成もこの中（blocking プールの中）で終わらせること。
    match format {
        BookFormat::YaneuraouDb => {
            let reader = crate::book::yaneuraou_db::load(path)?;
            Ok(OpenedBook {
                path: path.to_path_buf(),
                format,
                position_count: Some(reader.position_count()),
                reader: Box::new(reader),
            })
        }
        BookFormat::AperyBin | BookFormat::ShogiGuiSbk | BookFormat::YaneuraouYbb => {
            Err(BookError::new(
                BookErrorCode::UnsupportedFormat,
                format!(
                    "{}はまだ開けない。やねうら王テキスト定跡 (.db) なら開ける",
                    format.display_name()
                ),
            )
            .with_path(path.to_string_lossy()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// `OpenedBook` は Debug ではないので `unwrap_err` が使えない。
    fn open_err(path: &str) -> BookError {
        let Err(err) = open_reader(&PathBuf::from(path), BookFormat::YaneuraouDb) else {
            panic!("reader を持たない形式なのに open に成功した: {path}");
        };
        err
    }

    /// 解決のあとに実体が消えた場合の経路。選ぶ時点で存在しないパスは、
    /// 呼び出し側の解決が先に弾く。
    #[test]
    fn reports_a_missing_file() {
        let err = open_err("/nonexistent/book.db");
        assert_eq!(err.code(), BookErrorCode::NotFound);
        assert_eq!(err.path(), Some("/nonexistent/book.db"));
    }

    /// まだ読めない形式に当たった利用者へ届く唯一の文面。種別だけを見るテストでは、
    /// 案内を空にしても緑のまま通る。
    ///
    /// **読める形式が1つある状態では「別のファイルを試しても同じ」ではない。**
    /// 次にやれること（.db なら開ける）を出す。
    #[test]
    fn an_unsupported_format_tells_the_user_what_to_expect() {
        let file = std::env::temp_dir().join("obs-shogi-book-unsupported.bin");
        std::fs::write(&file, b"").expect("テスト用のファイルを作れない");

        let result = open_reader(&file, BookFormat::AperyBin);
        std::fs::remove_file(&file).expect("テスト用のファイルを消せない");

        let Err(err) = result else {
            panic!("reader を持たない形式なのに開けてしまった");
        };
        assert_eq!(err.code(), BookErrorCode::UnsupportedFormat);
        assert!(
            err.message().contains(BookFormat::AperyBin.display_name()),
            "開けなかった形式の名前が出ていない: {}",
            err.message()
        );
        assert!(
            err.message()
                .contains(BookFormat::YaneuraouDb.display_name()),
            "代わりに何が開けるか書かれていない: {}",
            err.message()
        );
    }

    /// 中身が読めない `.db` は、形式が未対応なのではなくファイルが壊れている。
    /// `UnsupportedFormat` にすると「このアプリでは無理」と読まれ、取得し直すという
    /// 復帰操作に辿り着けない。
    #[test]
    fn reports_a_broken_db_as_broken_content() {
        let file = std::env::temp_dir().join("obs-shogi-book-broken.db");
        std::fs::write(&file, b"not a book").expect("テスト用のファイルを作れない");

        let result = open_reader(&file, BookFormat::YaneuraouDb);
        std::fs::remove_file(&file).expect("テスト用のファイルを消せない");

        let Err(err) = result else {
            panic!("定跡でないファイルを開けてしまった");
        };
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
    }

    /// 読める形式は、開いた時点で収録局面数まで確定していること。
    /// `BookState::register` は async ランタイム上で走るので、そこで数える形に
    /// 戻すと IO が async ワーカへ漏れる。
    #[test]
    fn a_readable_book_is_counted_while_opening() {
        let file = std::env::temp_dir().join("obs-shogi-book-counted.db");
        std::fs::write(
            &file,
            b"#YANEURAOU-DB2016 1.00\n              sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1\n              7g7f 3c3d 50 32 1\n",
        )
        .expect("テスト用のファイルを作れない");

        let result = open_reader(&file, BookFormat::YaneuraouDb);
        std::fs::remove_file(&file).expect("テスト用のファイルを消せない");

        let opened = result.expect("読めるはず");
        assert_eq!(opened.position_count, Some(1));
        assert_eq!(opened.format, BookFormat::YaneuraouDb);
    }

    /// ディレクトリは存在するので NotFound ではない。「見つからない」と言われると
    /// 利用者は探し直してしまう。
    #[test]
    fn reports_a_directory_as_a_wrong_kind() {
        let dir = std::env::temp_dir().join("obs-shogi-book-open-reader-test.db");
        std::fs::create_dir_all(&dir).expect("テスト用のディレクトリを作れない");

        let result = open_reader(&dir, BookFormat::YaneuraouDb);
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        let Err(err) = result else {
            panic!("ディレクトリを定跡として開けてしまった");
        };
        assert_eq!(err.code(), BookErrorCode::InvalidType);
    }
}
