//! 定跡を開くまでの検査。
//!
//! **検査の順序を語るのはここ1箇所。** パスの形 → 拡張子から形式 → 実体の解決 →
//! 指定と実体の形式の一致 → ファイルであること、の順に落ちる。
//!
//! 最初の「パスの形」だけは [`validate_book_path`] という別の関門で、
//! 呼び手が先に通す。通した証拠が [`ValidatedBookPath`] で、[`open_at`] は
//! それしか受け取らないので、飛ばすとコンパイルが通らない。
//!
//! コマンド層から分けてあるのは、開き口がコマンドだけとは限らないため。
//! 起動時に前回の定跡を開き直す、reader の結合テストを書く、といった呼び手が
//! `tauri::State` を経由せずにここへ来られる。
//!
//! 形式そのものの検査（拡張子は `.db` だが中身が別形式、など）を足すときも
//! ここに置く。`reader` 側は「解決済みのパスと確定済みの形式を受け取って
//! reader を作る」だけに保つこと。

use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::{open_reader, OpenedBook};
use crate::book::types::BookFormat;
use std::path::{Path, PathBuf};

/// 定跡を開く。ファイルを読むので blocking プールから呼ぶこと。
///
/// 返すエラーの `path` は常に呼び出し側が渡した綴り。解決後のパスを載せると、
/// 利用者が一度も打っていないファイル名について「見つからない」「権限が無い」と
/// 言うことになり、選び直す先が分からなくなる。実体は message に添える。
pub(crate) fn open_at(path: &ValidatedBookPath) -> Result<OpenedBook, BookError> {
    let path = path.as_path();
    let (canonical, format) = resolve_book_path(path)?;

    // reader は実体のパスから作る。形式は解決の側で決めたものをそのまま渡す。
    // open_reader に決め直させると symlink をもう一度たどることになり、検査した
    // 先と実際に開くファイルが別物になりうる（その隙に張り替えられると
    // BookInfo.path() が旧い方を指す）。
    open_reader(&canonical, format).map_err(|err| requested_error(err, path, &canonical))
}

/// 実体のパスと、そこを開いてよい形式を決める。
///
/// 形式は利用者が指定した綴りから決める。symlink の指す先で判別すると、
/// `.db` を開いたつもりが黙って別形式として読まれる。一方 `BookInfo` に載るのは
/// 実体のパスなので、両者が食い違うと「.bin なのにやねうら王テキスト定跡」という
/// 値がフロントへ渡り、そのパスで開き直すと別形式の reader ができる。食い違うなら開かない。
fn resolve_book_path(path: &Path) -> Result<(PathBuf, BookFormat), BookError> {
    // 実在より先に形式を見る。canonicalize を先に呼ぶと、存在しない `.txt` に
    // UnknownExtension ではなく NotFound が返り、利用者は開けるはずの無い
    // ファイルを探し直すことになる。
    let requested = BookFormat::from_path(path)?;

    // 解決そのものが失敗したときは実体のパスが手に入らないが、リンク先の綴りは
    // 読める。外付けを外した symlink は「見つからない」だけだと Finder に見えている
    // ファイルを探し直すことになり、繋ぎ直すという唯一の復帰操作に辿り着けない。
    let canonical = std::fs::canonicalize(path).map_err(|e| {
        let err = BookError::from_io(e, path.to_string_lossy());
        match std::fs::read_link(path) {
            Ok(target) => annotate(err, &format!("リンク先 {}", target.display())),
            Err(_) => err,
        }
    })?;

    // リンク先の拡張子が判別できない場合も食い違いとして扱う。そのまま
    // UnknownExtension を返すと、利用者が選んでいないパスについて
    // 「拡張子から形式を判別できない」と言うことになる。
    let resolved = BookFormat::from_path(&canonical).ok();
    if resolved != Some(requested) {
        let resolved_name = resolved.map_or("判別できない形式", BookFormat::display_name);
        return Err(BookError::new(
            BookErrorCode::InvalidPath,
            format!(
                "リンク先 {} の形式が指定と違う（指定 {} / 実体 {}）。{PATH_RECOVERY}",
                canonical.display(),
                requested.display_name(),
                resolved_name
            ),
        )
        .with_path(path.to_string_lossy()));
    }

    Ok((canonical, requested))
}

/// 実体で起きた失敗を、利用者が渡した綴りの失敗として言い直す。
///
/// `path` を要求時の綴りに戻すだけだと、どのファイルを開こうとして失敗したのかが
/// フロントにもログにも残らない。symlink 越しに権限が無い場合、許可すべきファイル名が
/// どこにも現れなくなる。
fn requested_error(err: BookError, requested: &Path, canonical: &Path) -> BookError {
    let err = if requested == canonical {
        err
    } else {
        annotate(err, &format!("実体 {}", canonical.display()))
    };

    err.with_path(requested.to_string_lossy())
}

/// message に注記を足す。`path` は触らない。
fn annotate(err: BookError, note: &str) -> BookError {
    let annotated = BookError::new(err.code(), format!("{}（{note}）", err.message()));
    match err.path() {
        Some(path) => annotated.with_path(path),
        None => annotated,
    }
}

/// 形を検査したパスと、その検査。
///
/// 内側のモジュールに入れるのは、タプル構造体のフィールドが**同じモジュールからは
/// 見える**ため。ここに置かないと `open.rs` のどこからでも `ValidatedBookPath(p)`
/// と書けてしまい、型は何も止めない。
mod validated {
    use super::{BookError, BookErrorCode};
    use std::path::{Path, PathBuf};

    /// パスが受け付けられないときに利用者へ出す復帰操作。
    ///
    /// 「絶対パスで渡すこと」のような理由は呼び出し側（フロント）に向けた言葉で、
    /// 画面の前に居る人には何をすればよいか分からない。操作に翻訳して添える。
    pub(super) const PATH_RECOVERY: &str = "定跡ファイルを選び直すこと";

    /// 形の検査を通ったパス。[`validate_book_path`] 以外から作れない。
    ///
    /// `open_at` の引数をこの型にすることで、「先に形を検査する」という呼び順を
    /// コメントではなくコンパイラが強制する。このモジュールは開き口がコマンド
    /// だけとは限らないことを前提にしており（起動時の再オープン、reader の
    /// 結合テスト）、そういう呼び手はコマンド層の検査を通らずにここへ来る。
    #[derive(Debug)]
    pub(crate) struct ValidatedBookPath(PathBuf);

    impl ValidatedBookPath {
        pub(super) fn as_path(&self) -> &Path {
            &self.0
        }
    }

    /// フロントから来たパスの形を検査する。
    ///
    /// バンドルされた macOS アプリの CWD は `/` なので、相対パスは黙って解決に
    /// 失敗し、`BookInfo.path()` にもその相対文字列が残って UI に出しても意味を成さない。
    pub(crate) fn validate_book_path(raw: &str) -> Result<ValidatedBookPath, BookError> {
        let invalid = |reason: &str| {
            BookError::new(
                BookErrorCode::InvalidPath,
                format!("{reason}。{PATH_RECOVERY}"),
            )
            .with_path(raw)
        };

        if raw.trim().is_empty() {
            return Err(invalid("定跡のパスが空"));
        }

        // NUL 入りのパスは std が InvalidInput で弾く。素通しすると原因が Io に化けて、
        // 「パスの書き間違い」という復帰導線を出せなくなる。
        if raw.contains('\0') {
            return Err(invalid("定跡のパスに NUL が含まれている"));
        }

        let path = PathBuf::from(raw);
        if !path.is_absolute() {
            return Err(invalid("定跡のパスは絶対パスで渡すこと"));
        }

        Ok(ValidatedBookPath(path))
    }
}

use validated::PATH_RECOVERY;
pub(crate) use validated::{validate_book_path, ValidatedBookPath};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::error::MAX_PATH_CHARS;

    /// テストからも本番と同じ関門を通す。`open_at` は形を検査したパスしか
    /// 受け取らないので、ここを迂回する道はテストにも無い。
    fn validated(path: &Path) -> ValidatedBookPath {
        validate_book_path(&path.to_string_lossy()).expect("テスト用のパスは絶対パス")
    }

    /// symlink を張ったディレクトリを作る。返り値は (dir, 実体, リンク)。
    ///
    /// symlink を作れるのが unix だけなので、これを使うテストも unix でだけ走る。
    /// 形式の食い違い検査自体は Windows でも本番経路として動くが、**検証していない。**
    #[cfg(unix)]
    fn linked(name: &str, target_ext: &str, link_ext: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("obs-shogi-book-open-at-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("テスト用のディレクトリを作れない");

        let target = dir.join(format!("target{target_ext}"));
        let link = dir.join(format!("link{link_ext}"));
        std::fs::write(&target, b"").expect("テスト用のファイルを作れない");
        std::os::unix::fs::symlink(&target, &link).expect("symlink を作れない");

        (dir, target, link)
    }

    /// リンク先の拡張子が違うと、BookInfo の path と format が別のファイルを
    /// 指す値になる。開かせない。
    #[test]
    #[cfg(unix)]
    fn rejects_a_link_that_points_at_another_format() {
        let (dir, _target, link) = linked("mismatch", ".bin", ".db");
        let result = open_at(&validated(&link)).err().map(|err| err.code());
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        assert_eq!(result, Some(BookErrorCode::InvalidPath));
    }

    /// リンク先の拡張子が判別できない場合も、形式の食い違いとして扱う。
    #[test]
    #[cfg(unix)]
    fn rejects_a_link_whose_target_extension_is_unknown() {
        let (dir, _target, link) = linked("unknown", "", ".db");
        let result = open_at(&validated(&link)).err().map(|err| err.code());
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        assert_eq!(result, Some(BookErrorCode::InvalidPath));
    }

    /// 同じ形式を指す symlink は、形式の食い違いでは弾かない。
    #[test]
    #[cfg(unix)]
    fn a_link_to_the_same_format_passes_the_format_check() {
        let (dir, _target, link) = linked("same", ".db", ".db");
        let result = open_at(&validated(&link)).err().map(|err| err.code());
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        assert_ne!(result, Some(BookErrorCode::InvalidPath));
    }

    /// エラーに載るのは常に呼び出し側が渡した綴り。解決後のパスを載せると、
    /// 利用者が一度も打っていないファイル名について答えることになる。
    #[test]
    #[cfg(unix)]
    fn errors_report_the_requested_spelling_not_the_resolved_one() {
        let (dir, target, link) = linked("path", ".db", ".db");
        let mismatch = linked("path-mismatch", ".bin", ".db");

        // reader 由来（UnsupportedFormat）と食い違い由来（InvalidPath）の両方
        let from_reader = open_at(&validated(&link))
            .err()
            .and_then(|err| err.path().map(str::to_owned));
        let from_mismatch = open_at(&validated(&mismatch.2))
            .err()
            .and_then(|err| err.path().map(str::to_owned));

        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");
        std::fs::remove_dir_all(&mismatch.0).expect("テスト用のディレクトリを消せない");

        assert_eq!(
            from_reader.as_deref(),
            Some(link.to_string_lossy().as_ref())
        );
        assert_ne!(
            from_reader.as_deref(),
            Some(target.to_string_lossy().as_ref())
        );
        assert_eq!(
            from_mismatch.as_deref(),
            Some(mismatch.2.to_string_lossy().as_ref())
        );
    }

    fn some_error() -> BookError {
        BookError::new(BookErrorCode::NotFound, "定跡ファイルが見つからない")
    }

    /// path を要求時の綴りに戻すだけだと、どのファイルを開こうとして失敗したのかが
    /// フロントにもログにも残らない。symlink 越しに権限が無いとき、許可すべき
    /// ファイル名がどこにも出なくなる。
    #[test]
    fn adds_the_resolved_path_when_it_differs_from_the_requested_one() {
        let err = requested_error(
            some_error(),
            &PathBuf::from("/books/link.db"),
            &PathBuf::from("/vol/ext/target.db"),
        );

        assert!(
            err.message().contains("/vol/ext/target.db"),
            "message={}",
            err.message()
        );
        assert_eq!(err.path(), Some("/books/link.db"));
    }

    #[test]
    fn does_not_repeat_the_path_when_the_request_is_already_resolved() {
        let path = PathBuf::from("/books/a.db");
        let err = requested_error(some_error(), &path, &path);

        assert_eq!(err.message(), some_error().message());
        assert_eq!(err.path(), Some("/books/a.db"));
    }

    /// 解決自体が失敗する枝。実体は取れないが、リンク先の綴りは読める。
    /// ここを落とすと、外付けを外した定跡が「見つからない」だけになる。
    #[test]
    #[cfg(unix)]
    fn reports_the_link_target_when_it_cannot_be_resolved() {
        let dir = std::env::temp_dir().join("obs-shogi-book-dangling");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("テスト用のディレクトリを作れない");

        let missing = dir.join("gone.db");
        let link = dir.join("link.db");
        std::os::unix::fs::symlink(&missing, &link).expect("symlink を作れない");

        let err = open_at(&validated(&link)).err();
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        let err = err.expect("リンク先が無いので必ず失敗する");
        assert_eq!(err.code(), BookErrorCode::NotFound);
        assert!(
            err.message().contains(missing.to_string_lossy().as_ref()),
            "message={}",
            err.message()
        );
        assert_eq!(err.path(), Some(link.to_string_lossy().as_ref()));
    }

    #[test]
    fn accepts_an_absolute_path() {
        let path = validate_book_path("/books/standard.db").unwrap();
        assert_eq!(path.as_path(), Path::new("/books/standard.db"));
    }

    #[test]
    fn rejects_a_path_that_cannot_point_at_a_file() {
        for raw in ["", "   ", "books/standard.db", "./standard.db", "a\0b.db"] {
            let err = validate_book_path(raw).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidPath, "raw={raw:?}");
            assert_eq!(err.path(), Some(raw));
        }
    }

    /// 「絶対パスで渡すこと」は呼び出し側に向けた言葉で、画面の前に居る人には
    /// 次の操作が無い。種別だけを見る上のテストは、案内を消しても緑のまま通る。
    #[test]
    fn a_rejected_path_tells_the_user_what_to_do_next() {
        for raw in ["", "   ", "books/standard.db", "a\0b.db"] {
            let err = validate_book_path(raw).unwrap_err();
            // 定数と突き合わせない。`contains(PATH_RECOVERY)` は案内を空にすると
            // 常に真になり、案内が消えたことをこのテストが見逃す。
            assert!(
                err.message().contains("選び直すこと"),
                "raw={raw:?} message={}",
                err.message()
            );
        }
    }

    /// 長いパスは弾かずに、エラーへ載せるときだけ打ち切る。
    /// 弾くと、深い階層に定跡を置いている利用者が行き止まりになる。
    #[test]
    fn an_over_long_path_is_truncated_in_the_error_but_not_rejected() {
        let long = format!("/{}", "a".repeat(MAX_PATH_CHARS));
        assert!(
            validate_book_path(&long).is_ok(),
            "長さだけを理由に弾いている"
        );

        // 弾かれる理由が別にある場合、載る path は打ち切られている
        let relative = "a".repeat(MAX_PATH_CHARS + 10);
        let err = validate_book_path(&relative).unwrap_err();
        assert_truncated_path(&err);
    }

    /// 検査を通った長いパスも、下流の失敗で載るときには打ち切られていること。
    ///
    /// `validate_book_path` は長さで弾かないので、**通り抜けた長いパスが
    /// `open_at` 以降の全ての経路へ生のまま流れる**。`validate_book_path` だけを
    /// 見るテストでは、この経路を1つも踏まない。
    #[test]
    fn an_over_long_path_that_passes_validation_is_truncated_downstream() {
        // 実在しないので canonicalize が必ず失敗する
        let long = format!("/{}.db", "a".repeat(MAX_PATH_CHARS));
        let err = open_at(&validated(Path::new(&long)))
            .err()
            .expect("開けるはずがない");

        assert_truncated_path(&err);
    }

    fn assert_truncated_path(err: &BookError) {
        let path = err.path().expect("path が載っていない");
        assert_eq!(path.chars().count(), MAX_PATH_CHARS + 1, "…のぶんだけ長い");
        assert!(path.ends_with('…'), "切れたことが分からない");
    }
}
