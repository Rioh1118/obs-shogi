use crate::book::error::{format_size, BookError, BookErrorCode};
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

/// 形式ごとの、1バイトも読まずに落とす大きさの上限。
///
/// 読める形式の1件ぶん。
struct Support {
    /// 1バイトも読まずに落とす大きさの上限。`None` なら上限を掛けない
    /// （on-the-fly で読む形式は、大きさそのものが問題にならない）。
    max_file_bytes: Option<u64>,
    /// 解決済みのパスと `metadata` の大きさから reader を作る。
    open: fn(&Path, u64) -> Result<OpenedBook, BookError>,
}

/// 形式ごとの表。**読める形式の情報はここ1箇所にまとめる。**
///
/// 上限と reader を別々の `match` に分けてはいけない。どちらも網羅的なので
/// コンパイラは何も言わないが、**reader を足して上限の枝を直し忘れると、
/// 検査が黙って外れる**。1つにまとめておけば、`Support` を書いた時点で
/// 上限を決めることになる。
///
/// `match` で書くこと。形式を足すと枝が足りなくなってコンパイルが止まる。
/// `if let` や `_ =>` にすると、新しい形式が既定値で素通りする。
fn support(format: BookFormat) -> Option<Support> {
    match format {
        BookFormat::YaneuraouDb => Some(Support {
            max_file_bytes: Some(crate::book::yaneuraou_db::MAX_FILE_BYTES),
            open: |path, size| {
                let reader = crate::book::yaneuraou_db::load(path, size)?;
                Ok(OpenedBook {
                    path: path.to_path_buf(),
                    format: BookFormat::YaneuraouDb,
                    position_count: Some(reader.position_count()),
                    reader: Box::new(reader),
                })
            },
        }),
        // reader をまだ持っていない。
        BookFormat::AperyBin | BookFormat::ShogiGuiSbk | BookFormat::YaneuraouYbb => None,
    }
}

/// 開ける大きさか。
///
/// **[`BookErrorCode::InvalidContent`] にしない。** 「壊れている」と読まれると
/// 取得し直すという効かない復帰操作へ誘導する。ファイルは正しく、大きすぎるだけ。
fn check_file_size(size: u64, limit: Option<u64>, path: &str) -> Result<(), BookError> {
    let Some(limit) = limit else {
        return Ok(());
    };
    if size <= limit {
        return Ok(());
    }
    Err(BookError::new(
        BookErrorCode::TooLarge,
        format!(
            "この定跡はこのアプリで開ける大きさを超えている（{} / 上限 {}）。\
             より小さい定跡を開くこと",
            format_size(size),
            format_size(limit)
        ),
    )
    .with_path(path))
}

/// 実体のファイルを開いて reader を作る。
///
/// `path` は canonicalize 済み、`format` は**その綴りから決めた形式**を渡すこと。
/// ここで拡張子から決め直すと、呼び出し側が形式を検査した先と実際に開く
/// ファイルが別物になりうる（symlink を張り替えられる隙が空く）。
///
/// 返るもの:
///
/// - [`BookErrorCode::NotFound`] / [`BookErrorCode::PermissionDenied`] /
///   [`BookErrorCode::Io`] — metadata が取れない、または読んでいる途中で失敗した
/// - [`BookErrorCode::InvalidType`] — ディレクトリなどファイルでないもの
/// - [`BookErrorCode::InvalidContent`] — 形式の中身が読めない
/// - [`BookErrorCode::TooLarge`] — 形式ごとの大きさの上限を超える
/// - [`BookErrorCode::UnsupportedFormat`] — 形式は分かるが reader をまだ持っていない
///
/// **列挙はリンクで書くこと。** 呼び手はこの列挙を見て `code` の分岐を書くので、
/// 種別を足したときにここが古いままだと、そのまま分岐から漏れる。綴りで書くと
/// `cargo doc` にも掛からない（#305）。
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

    // **未対応が先、大きさが後。** 縮めても開けない形式に「大きすぎる」と
    // 言われても、利用者にできることが無い。
    let Some(support) = support(format) else {
        return Err(BookError::new(
            BookErrorCode::UnsupportedFormat,
            format!(
                "{}はまだ開けない。やねうら王テキスト定跡 (.db) なら開ける",
                format.display_name()
            ),
        )
        .with_path(path.to_string_lossy()));
    };

    // **中身を読む前に落とす。** `metadata` は既に取ってあるので、
    // 1バイトも読まずに済む。
    check_file_size(meta.len(), support.max_file_bytes, &path.to_string_lossy())?;

    // 数え上げも reader の生成もこの中（blocking プールの中）で終わらせること。
    (support.open)(path, meta.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn db_limit() -> u64 {
        support(BookFormat::YaneuraouDb)
            .expect("reader がある")
            .max_file_bytes
            .expect("上限がある")
    }

    /// `OpenedBook` は Debug ではないので `unwrap_err` が使えない。
    fn open_err(path: &str) -> BookError {
        let Err(err) = open_reader(&PathBuf::from(path), BookFormat::YaneuraouDb) else {
            panic!("失敗するはずのパスで開けてしまった: {path}");
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
        let dir = crate::book::test_paths::scratch_dir("unsupported");
        let file = dir.join("a.bin");
        std::fs::write(&file, b"").expect("テスト用のファイルを作れない");

        let result = open_reader(&file, BookFormat::AperyBin);
        let _ = std::fs::remove_dir_all(&dir);

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
        let dir = crate::book::test_paths::scratch_dir("broken");
        let file = dir.join("a.db");
        std::fs::write(&file, b"not a book").expect("テスト用のファイルを作れない");

        let result = open_reader(&file, BookFormat::YaneuraouDb);
        let _ = std::fs::remove_dir_all(&dir);

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
        let dir = crate::book::test_paths::scratch_dir("counted");
        let file = dir.join("a.db");
        std::fs::write(
            &file,
            b"#YANEURAOU-DB2016 1.00\n              sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1\n              7g7f 3c3d 50 32 1\n",
        )
        .expect("テスト用のファイルを作れない");

        let result = open_reader(&file, BookFormat::YaneuraouDb);
        let _ = std::fs::remove_dir_all(&dir);

        let opened = result.expect("読めるはず");
        assert_eq!(opened.position_count, Some(1));
        assert_eq!(opened.format, BookFormat::YaneuraouDb);
    }

    /// 上限を超えたら、1バイトも読まずに落とすこと。
    ///
    /// **種別を `InvalidContent` にしない。** 「壊れている」と読まれると、
    /// 取得し直すという効かない復帰操作へ誘導する。ファイルは正しく、
    /// 大きすぎるだけ。
    #[test]
    fn a_file_over_the_limit_is_refused() {
        let limit = db_limit();
        let Err(err) = check_file_size(limit + 1, Some(limit), "/books/huge.db") else {
            panic!("上限を超えたのに通してしまった");
        };

        assert_eq!(err.code(), BookErrorCode::TooLarge);
        assert_eq!(err.path(), Some("/books/huge.db"));
        // 上限がいくつかを伝えないと、どれくらい小さくすればよいか分からない
        assert!(err.message().contains("2.1GB"), "{}", err.message());
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    /// 上限ちょうどは通す。境界で1バイト間違えると、上限近くの定跡が開けなくなる。
    #[test]
    fn a_file_at_the_limit_is_accepted() {
        let limit = db_limit();
        assert!(check_file_size(limit, Some(limit), "/books/a.db").is_ok());
    }

    /// **`open_reader` を実際に通して、1バイトも読まないことを見る。**
    ///
    /// `check_file_size` を直接呼ぶテストだけだと、`open_reader` からその
    /// 呼び出しを消す変更が緑で通る。検査を形式の分岐より前へ出した意味が
    /// そこにあるので、呼び出し位置ごと固定する。
    ///
    /// sparse file なので費用は掛からない（実測で 0.3ms / ディスク 0 ブロック）。
    /// 中身は1バイトも書いていないため、**読みに行けば必ず `InvalidContent`**。
    /// つまりこのテストは「読まずに落ちた」ことまで見ている。
    #[test]
    fn an_over_sized_file_is_refused_without_reading_it() {
        let dir = crate::book::test_paths::scratch_dir("over-sized");
        let file = dir.join("huge.db");
        let handle = std::fs::File::create(&file).expect("テスト用のファイルを作れない");
        handle
            .set_len(crate::book::yaneuraou_db::MAX_FILE_BYTES + 1)
            .expect("大きさを設定できない");
        drop(handle);

        let result = open_reader(&file, BookFormat::YaneuraouDb);
        let _ = std::fs::remove_dir_all(&dir);

        let Err(err) = result else {
            panic!("上限を超えたのに開けてしまった");
        };
        assert_eq!(err.code(), BookErrorCode::TooLarge, "{}", err.message());
    }

    /// **reader がまだ無い形式は、大きさより先に「対応していない」と言うこと。**
    /// 縮めても開けないので、大きさを言われても利用者にできることが無い。
    ///
    /// **`open_reader` を通して見る。** `support` に問い合わせるだけの形だと、
    /// その形式に reader を足した時点でテスト名だけが嘘になり、順序を守らない。
    #[test]
    fn an_unsupported_format_is_not_reported_as_too_large() {
        let dir = crate::book::test_paths::scratch_dir("unsupported-over-sized");
        let file = dir.join("huge.bin");
        let handle = std::fs::File::create(&file).expect("テスト用のファイルを作れない");
        handle
            .set_len(crate::book::yaneuraou_db::MAX_FILE_BYTES * 4)
            .expect("大きさを設定できない");
        drop(handle);

        let result = open_reader(&file, BookFormat::AperyBin);
        let _ = std::fs::remove_dir_all(&dir);

        let Err(err) = result else {
            panic!("reader を持たない形式なのに開けてしまった");
        };
        assert_eq!(
            err.code(),
            BookErrorCode::UnsupportedFormat,
            "{}",
            err.message()
        );
    }

    /// **reader を足すときに上限も決めること。** 上限と reader を別々の `match` に
    /// 分けていると、reader を足して上限の枝を直し忘れた状態がコンパイルを通る。
    #[test]
    fn every_readable_format_has_a_size_limit() {
        for format in [
            BookFormat::YaneuraouDb,
            BookFormat::AperyBin,
            BookFormat::ShogiGuiSbk,
            BookFormat::YaneuraouYbb,
        ] {
            let Some(support) = support(format) else {
                continue;
            };
            let limit = support
                .max_file_bytes
                .unwrap_or_else(|| panic!("{format:?} に上限が無い"));
            assert!(
                (100_000_000..100_000_000_000).contains(&limit),
                "上限が現実的な範囲に無い: {format:?} {limit}"
            );
        }
    }

    /// ディレクトリは存在するので NotFound ではない。「見つからない」と言われると
    /// 利用者は探し直してしまう。
    #[test]
    fn reports_a_directory_as_a_wrong_kind() {
        let dir = crate::book::test_paths::scratch_dir("a-directory");
        let result = open_reader(&dir, BookFormat::YaneuraouDb);
        let _ = std::fs::remove_dir_all(&dir);

        let Err(err) = result else {
            panic!("ディレクトリを定跡として開けてしまった");
        };
        assert_eq!(err.code(), BookErrorCode::InvalidType);
    }
}
