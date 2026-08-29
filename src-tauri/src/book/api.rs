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
/// 検査は パスの形 → 拡張子 → 実体の解決 → 指定と実体の形式の一致 → ファイルであること
/// の順で、落ちた検査の種別が返る。全て通っても、その形式の reader を持っていなければ
/// `UnsupportedFormat` になる。どの形式を読めるかは `reader::open_reader` を見ること。
#[tauri::command]
pub async fn open_book(
    state: State<'_, BookState>,
    input: OpenBookInput,
) -> Result<BookInfo, BookError> {
    logged("open_book", open_book_inner(&state, input).await)
}

async fn open_book_inner(state: &BookState, input: OpenBookInput) -> Result<BookInfo, BookError> {
    // 検査を通ってからログに書く。生のまま書くと、弾かれる入力であっても
    // その前にログ（200KB でローテート）を使い切られる。
    let path = validate_book_path(&input.path)?;
    log::info!("[cmd] open_book path={}", path.display());

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
    pub(crate) position_count: Option<u64>,
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
    let err = if requested == canonical {
        err
    } else {
        annotate(err, &format!("実体 {}", canonical.display()))
    };

    err.with_path(requested.to_string_lossy())
}

/// message に注記を足す。`path` は触らない。
fn annotate(err: BookError, note: &str) -> BookError {
    let annotated = BookError::new(err.code, format!("{}（{note}）", err.message));
    match err.path {
        Some(path) => annotated.with_path(path),
        None => annotated,
    }
}

/// エラーに載せるパスの上限。
///
/// 出荷対象のうち最も緩い Linux の `PATH_MAX`（4096 バイト）を、文字数で数えても
/// 下回らない値にしてある。**弾くためではなく、打ち切るための値。**
/// 長いパスを拒否すると、深い階層に定跡を置いている利用者が行き止まりになる。
const MAX_PATH_CHARS: usize = 4096;

/// エラーに載せるパスを打ち切る。切れていることが分かるように印を付ける。
fn truncate_path(raw: &str) -> String {
    let mut out: String = raw.chars().take(MAX_PATH_CHARS).collect();
    if out.chars().count() < raw.chars().count() {
        out.push('…');
    }
    out
}

/// フロントから来たパスの形を検査する。
///
/// バンドルされた macOS アプリの CWD は `/` なので、相対パスは黙って解決に
/// 失敗し、`BookInfo.path` にもその相対文字列が残って UI に出しても意味を成さない。
fn validate_book_path(raw: &str) -> Result<PathBuf, BookError> {
    // エラーに載せる path は打ち切る。raw はコマンド境界から来る任意長の文字列で、
    // BookError の Display は path を含めてログへ出る。
    let invalid = |reason: &str| {
        BookError::new(BookErrorCode::InvalidPath, reason.to_string()).with_path(truncate_path(raw))
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
///
/// ただし `Arc` を取るのは最後。失敗しうる処理を跨いで持つと、その枝で
/// 落ちた `Arc` が最後の参照だったときに reader の Drop が async ワーカで走る。
fn resolve_lookup(
    state: &BookState,
    input: &LookupBookMovesInput,
) -> Result<(Arc<BookSession>, BookKey), BookError> {
    state.info(input.handle)?;
    let key = to_book_key(&input.sfen)?;
    Ok((state.get(input.handle)?, key))
}

/// 開いている定跡のメタ情報。
#[tauri::command]
pub fn get_book_info(
    state: State<'_, BookState>,
    input: BookHandleInput,
) -> Result<BookInfo, BookError> {
    logged("get_book_info", state.info(input.handle))
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
        fn position_count(&self) -> Option<u64> {
            Some(0)
        }

        fn lookup(&self, _key: &BookKey) -> Result<Vec<BookMove>, BookError> {
            Ok(Vec::new())
        }
    }

    fn opened(path: &str) -> OpenedBook {
        OpenedBook {
            path: PathBuf::from(path),
            format: BookFormat::YaneuraouDb,
            position_count: Some(0),
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

    /// 壊れた局面では `get` を呼ばないこと。
    ///
    /// 先に `Arc` を取る形に戻すと、その枝で落ちた `Arc` が最後の参照だったときに
    /// reader の Drop が async ワーカで走る。返る種別は両方の順序で同じなので、
    /// 種別を見るテストではこの差を捕まえられない。
    #[test]
    fn a_broken_position_does_not_take_a_reference() {
        let state = BookState::new();
        let info = state.register(opened("/books/a.db"));

        let err = resolve_lookup(&state, &lookup_input(info.handle, "壊れた局面")).unwrap_err();

        assert_eq!(err.code, BookErrorCode::InvalidSfen);
        assert_eq!(state.get_calls(), 0);
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
            err.message.contains("/vol/ext/target.db"),
            "message={}",
            err.message
        );
        assert_eq!(err.path.as_deref(), Some("/books/link.db"));
    }

    #[test]
    fn does_not_repeat_the_path_when_the_request_is_already_resolved() {
        let path = PathBuf::from("/books/a.db");
        let err = requested_error(some_error(), &path, &path);

        assert_eq!(err.message, some_error().message);
        assert_eq!(err.path.as_deref(), Some("/books/a.db"));
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

        let err = open_at(&link).err();
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        let err = err.expect("リンク先が無いので必ず失敗する");
        assert_eq!(err.code, BookErrorCode::NotFound);
        assert!(
            err.message.contains(missing.to_string_lossy().as_ref()),
            "message={}",
            err.message
        );
        assert_eq!(err.path.as_deref(), Some(link.to_string_lossy().as_ref()));
    }

    #[test]
    fn accepts_an_absolute_path() {
        let path = validate_book_path("/books/standard.db").unwrap();
        assert_eq!(path, PathBuf::from("/books/standard.db"));
    }

    #[test]
    fn rejects_a_path_that_cannot_point_at_a_file() {
        for raw in ["", "   ", "books/standard.db", "./standard.db", "a\0b.db"] {
            let err = validate_book_path(raw).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidPath, "raw={raw:?}");
            assert_eq!(err.path.as_deref(), Some(raw));
        }
    }

    /// 長いパスは弾かずに、エラーへ載せるときだけ打ち切る。
    /// 弾くと、深い階層に定跡を置いている利用者が行き止まりになる
    /// （Linux の PATH_MAX は 4096）。
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
        let path = err.path.expect("path が載っていない");
        assert_eq!(path.chars().count(), MAX_PATH_CHARS + 1, "…のぶんだけ長い");
        assert!(path.ends_with('…'), "切れたことが分からない");
    }
}
