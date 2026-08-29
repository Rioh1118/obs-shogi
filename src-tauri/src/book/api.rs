use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::{open_reader, BookReader};
use crate::book::session::BookSession;
use crate::book::session::BookState;
use crate::book::sfen::to_book_key;
use crate::book::sfen::BookKey;
use crate::book::types::{
    BookFormat, BookHandleInput, BookInfo, BookMove, LookupBookMovesInput, OpenBookInput,
};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;

/// 定跡を開いてハンドルを返す。
///
/// ファイルを読んで解析する処理なので、blocking プールへ逃がして
/// コマンドの async ランタイムを塞がないようにする。
///
/// 棋譜と違い、定跡はエンジン同梱のディレクトリや外付けドライブなど
/// プロジェクト root の外に置かれる。`file_system` の `validate_under_root` は
/// 当てられないので、パスに課す条件は `OpenBookInput::path` に書いた形だけになる。
///
/// `.db` の reader が入る #91 まで、このコマンドは成功しない。パスと形式の検査を
/// 通った場合の失敗が `UnsupportedFormat` で、通らなければそれぞれの種別が返る。
#[tauri::command]
pub async fn open_book(
    state: State<'_, BookState>,
    input: OpenBookInput,
) -> Result<BookInfo, BookError> {
    log::info!("[cmd] open_book path={}", input.path);
    logged("open_book", open_book_inner(&state, input).await)
}

async fn open_book_inner(state: &BookState, input: OpenBookInput) -> Result<BookInfo, BookError> {
    let path = validate_book_path(&input.path)?;

    let opened = tauri::async_runtime::spawn_blocking(move || open_at(&path))
        .await
        .map_err(join_error(input.path, "もう一度開き直すこと"))?;

    Ok(state.register(opened?))
}

/// 開いた定跡ひとつぶんの材料。
///
/// `format` と `position_count` を reader ではなくここに持つのは、どちらも
/// [`open_at`]（blocking プールの中）で確定させるため。`BookState::register` は
/// async ランタイム上で走るので、そこで reader に問い合わせる形にすると、
/// ヘッダを読んで答える実装が入った瞬間に IO が async ワーカで走る。
pub(crate) struct OpenedBook {
    pub(crate) path: PathBuf,
    pub(crate) format: BookFormat,
    pub(crate) position_count: u64,
    pub(crate) reader: Box<dyn BookReader>,
}

/// 定跡を開く。ファイルを読むので blocking プールから呼ぶこと。
///
/// 返すエラーの `path` は常に呼び出し側が渡した綴り。解決後のパスを載せると、
/// 利用者が一度も打っていないファイル名について「見つからない」「権限が無い」と
/// 言うことになり、選び直す先が分からなくなる。実体は message に添える。
fn open_at(path: &Path) -> Result<OpenedBook, BookError> {
    let (canonical, format) = resolve_book_path(path)?;

    // reader も実体のパスから作る。指定した綴りを渡すと open_reader が
    // symlink をもう一度たどるので、検査した先と実際に開くファイルが別物に
    // なりうる（その隙に張り替えられると BookInfo.path が旧い方を指す）。
    let reader = open_reader(&canonical).map_err(|err| requested_error(err, path, &canonical))?;

    Ok(OpenedBook {
        format,
        position_count: reader.position_count(),
        path: canonical,
        reader,
    })
}

/// 実体のパスと、そこを開いてよい形式を決める。
///
/// 形式は利用者が指定した綴りから決める。symlink の指す先で判別すると、
/// `.db` を開いたつもりが黙って別形式として読まれる。一方 `BookInfo` に載るのは
/// 実体のパスなので、両者が食い違うと「.bin なのにやねうら王テキスト定跡」という
/// 値がフロントへ渡り、そのパスで開き直すと別形式の reader ができる。食い違うなら開かない。
fn resolve_book_path(path: &Path) -> Result<(PathBuf, BookFormat), BookError> {
    // 実在より先に形式を見るのは open_reader と同じ理由で、形式が分からないものは
    // 実在しても開きようが無いから。canonicalize を先に呼ぶと、存在しない `.txt` に
    // UnknownExtension ではなく NotFound が返る。
    let requested = BookFormat::from_path(path)?;

    let canonical =
        std::fs::canonicalize(path).map_err(|e| BookError::from_io(e, path.to_string_lossy()))?;

    // リンク先の拡張子が判別できない場合も食い違いとして扱う。そのまま
    // UnknownExtension を返すと、利用者が選んでいないパスについて
    // 「拡張子から形式を判別できない」と言うことになる。
    let resolved = BookFormat::from_path(&canonical).ok();
    if resolved != Some(requested) {
        let resolved_name = resolved.map_or("判別できない形式", BookFormat::display_name);
        return Err(BookError::new(
            BookErrorCode::InvalidPath,
            format!(
                "リンク先 {} の形式が指定と違う（指定 {} / 実体 {}）",
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
    let message = if requested == canonical {
        err.message
    } else {
        format!("{}（実体 {}）", err.message, canonical.display())
    };

    BookError::new(err.code, message).with_path(requested.to_string_lossy())
}

/// フロントから来たパスの形を検査する。
///
/// バンドルされた macOS アプリの CWD は `/` なので、相対パスは黙って解決に
/// 失敗し、`BookInfo.path` にもその相対文字列が残って UI に出しても意味を成さない。
fn validate_book_path(raw: &str) -> Result<PathBuf, BookError> {
    let invalid = |reason: &str| {
        BookError::new(BookErrorCode::InvalidPath, reason.to_string()).with_path(raw)
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

    Ok(path)
}

/// 局面の候補手を引く。未収録なら空を返す。
#[tauri::command]
pub async fn lookup_book_moves(
    state: State<'_, BookState>,
    input: LookupBookMovesInput,
) -> Result<Vec<BookMove>, BookError> {
    logged("lookup_book_moves", lookup_inner(&state, input).await)
}

async fn lookup_inner(
    state: &BookState,
    input: LookupBookMovesInput,
) -> Result<Vec<BookMove>, BookError> {
    let (book, key) = resolve_lookup(state, &input)?;
    let path = book.info.path.clone();

    // on-the-fly の reader はここでファイルを読むので、in-memory でも blocking 扱いに揃える。
    tauri::async_runtime::spawn_blocking(move || book.reader.lookup(&key))
        .await
        .map_err(join_error(path, "この定跡を閉じてから開き直すこと"))?
}

/// 引く先と引くキーを揃える。
///
/// ハンドルを先に見る。ハンドルが閉じられていて SFEN も壊れている入力で
/// InvalidSfen だけを返すと、フロントは定跡が閉じられていることに気づけず、
/// 開き直す導線を出せない。
fn resolve_lookup(
    state: &BookState,
    input: &LookupBookMovesInput,
) -> Result<(Arc<BookSession>, BookKey), BookError> {
    let book = state.get(input.handle)?;
    let key = to_book_key(&input.sfen)?;
    Ok((book, key))
}

/// 開いている定跡のメタ情報。
#[tauri::command]
pub fn get_book_info(
    state: State<'_, BookState>,
    input: BookHandleInput,
) -> Result<BookInfo, BookError> {
    logged(
        "get_book_info",
        state.get(input.handle).map(|book| book.info.clone()),
    )
}

/// 開いている定跡を全て返す。
///
/// ハンドルはフロントの変数にしか無いので、webview が作り直されると閉じる術が
/// 無くなり、定跡ぶんのメモリがプロセス終了まで残る。起動時にここを引いて、
/// 自分が知らないハンドルを回収する。
#[tauri::command]
pub fn list_books(state: State<'_, BookState>) -> Vec<BookInfo> {
    state.list()
}

/// 開いている定跡を全て閉じる。
#[tauri::command]
pub async fn close_all_books(state: State<'_, BookState>) -> Result<usize, BookError> {
    let sessions = state.close_all();
    let closed = sessions.len();
    log::info!("[cmd] close_all_books closed={closed}");

    drop_in_background(sessions).await;

    Ok(closed)
}

/// 閉じる。ハンドルは以後 InvalidHandle になる。
///
/// 解放も blocking プールで行う。メモリに展開する reader では Drop が収録局面ぶんの
/// 解放になるので、async ランタイムのワーカで走らせると他のコマンドの応答が止まる。
#[tauri::command]
pub async fn close_book(
    state: State<'_, BookState>,
    input: BookHandleInput,
) -> Result<(), BookError> {
    log::info!("[cmd] close_book handle={}", input.handle);
    logged("close_book", close_book_inner(&state, input).await)
}

async fn close_book_inner(state: &BookState, input: BookHandleInput) -> Result<(), BookError> {
    let session = state.close(input.handle)?;
    drop_in_background(session).await;
    Ok(())
}

/// 定跡を blocking プールで捨てる。
///
/// ここへ来た時点でハンドルは既に map から外れているので、解放そのものが
/// 失敗しても呼び出し側にとっては閉じ終わっている。失敗として返すと、利用者は
/// 「閉じられなかった」と読んで再試行し、InvalidHandle で行き止まりになる。
async fn drop_in_background<T: Send + 'static>(value: T) {
    if let Err(err) = tauri::async_runtime::spawn_blocking(move || drop(value)).await {
        log::error!("[cmd] 定跡の解放が異常終了した: {err}");
    }
}

/// 失敗をログに残す。
///
/// 定跡が開けなかったという報告を受けたとき、権限なのか拡張子なのか壊れた
/// ファイルなのかをログから切り分けられるようにする。種別を持たせた設計は
/// フロントに届くだけでは足りない。
fn logged<T>(command: &str, result: Result<T, BookError>) -> Result<T, BookError> {
    if let Err(err) = &result {
        log::warn!("[cmd] {command} failed: {err}");
    }
    result
}

/// blocking プールへ投げた処理が panic などで落ちたときの受け皿。
///
/// どの定跡で起きたかを必ず添える。複数開いていると、これが無いと利用者は
/// どのファイルの話なのか決められない。
///
/// `recovery` は呼び出し側から渡す。open の途中で落ちた場合はまだハンドルが
/// 無いので、「閉じてから開き直す」は案内できない。
fn join_error(
    path: impl Into<String>,
    recovery: &'static str,
) -> impl FnOnce(tauri::Error) -> BookError {
    move |err| {
        BookError::new(
            BookErrorCode::Unknown,
            format!("定跡の処理が異常終了した。{recovery}（{err}）"),
        )
        .with_path(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::reader::BookReader;
    use crate::book::types::BookFormat;

    struct FakeReader;

    impl BookReader for FakeReader {
        fn position_count(&self) -> u64 {
            0
        }

        fn lookup(&self, _key: &BookKey) -> Result<Vec<BookMove>, BookError> {
            Ok(Vec::new())
        }
    }

    fn opened(path: &str) -> OpenedBook {
        OpenedBook {
            path: PathBuf::from(path),
            format: BookFormat::YaneuraouDb,
            position_count: 0,
            reader: Box::new(FakeReader),
        }
    }

    fn lookup_input(handle: u64, sfen: &str) -> LookupBookMovesInput {
        LookupBookMovesInput {
            handle,
            sfen: sfen.to_string(),
        }
    }

    /// 両方が壊れている入力で SFEN の側だけを返すと、フロントは定跡が
    /// 閉じられていることに気づけない。
    #[test]
    fn reports_a_closed_handle_before_a_broken_position() {
        let state = BookState::new();
        let info = state.register(opened("/books/a.db"));
        drop(state.close(info.handle).unwrap());

        let err = resolve_lookup(&state, &lookup_input(info.handle, "壊れた局面")).unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidHandle);
    }

    #[test]
    fn reports_a_broken_position_for_a_live_handle() {
        let state = BookState::new();
        let info = state.register(opened("/books/a.db"));

        let err = resolve_lookup(&state, &lookup_input(info.handle, "壊れた局面")).unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidSfen);
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
        let result = open_at(&link).err().map(|err| err.code);
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        assert_eq!(result, Some(BookErrorCode::InvalidPath));
    }

    /// リンク先の拡張子が判別できない場合も、形式の食い違いとして扱う。
    #[test]
    #[cfg(unix)]
    fn rejects_a_link_whose_target_extension_is_unknown() {
        let (dir, _target, link) = linked("unknown", "", ".db");
        let result = open_at(&link).err().map(|err| err.code);
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        assert_eq!(result, Some(BookErrorCode::InvalidPath));
    }

    /// 同じ形式を指す symlink は、形式の食い違いでは弾かない。
    #[test]
    #[cfg(unix)]
    fn a_link_to_the_same_format_passes_the_format_check() {
        let (dir, _target, link) = linked("same", ".db", ".db");
        let result = open_at(&link).err().map(|err| err.code);
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
        let from_reader = open_at(&link).err().and_then(|err| err.path);
        let from_mismatch = open_at(&mismatch.2).err().and_then(|err| err.path);

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

    /// path を要求時の綴りに戻すだけだと、どのファイルを開こうとして失敗したのかが
    /// フロントにもログにも残らない。symlink 越しに権限が無いとき、許可すべき
    /// ファイル名がどこにも出なくなる。
    #[test]
    #[cfg(unix)]
    fn errors_keep_the_resolved_path_in_the_message() {
        let (dir, target, link) = linked("message", ".db", ".db");
        // macOS の /var は /private/var への symlink なので、実体は canonicalize で取る
        let resolved = std::fs::canonicalize(&target).expect("実体を解決できない");

        let through_link = open_at(&link).err().map(|err| err.message);
        let direct = open_at(&resolved).err().map(|err| err.message);
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        let through_link = through_link.expect("reader がまだ無いので必ず失敗する");
        assert!(
            through_link.contains(resolved.to_string_lossy().as_ref()),
            "message={through_link}"
        );

        // 渡した綴りが実体そのものなら、同じパスを二度書かない
        let direct = direct.expect("reader がまだ無いので必ず失敗する");
        assert!(!direct.contains("実体"), "message={direct}");
    }

    #[test]
    fn reports_the_extension_before_looking_at_the_file_system() {
        let err = open_at(&PathBuf::from("/nonexistent/book.txt"))
            .err()
            .map(|e| e.code);
        assert_eq!(err, Some(BookErrorCode::UnknownExtension));
    }

    #[test]
    fn accepts_an_absolute_path() {
        let path = validate_book_path("/books/standard.db").unwrap();
        assert_eq!(path, PathBuf::from("/books/standard.db"));
    }

    #[test]
    fn rejects_a_path_that_cannot_be_resolved() {
        for raw in ["", "   ", "books/standard.db", "./standard.db", "a\0b.db"] {
            let err = validate_book_path(raw).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidPath, "raw={raw:?}");
            assert_eq!(err.path.as_deref(), Some(raw));
        }
    }
}
