use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::open_reader;
use crate::book::session::BookSession;
use crate::book::session::BookState;
use crate::book::sfen::to_book_key;
use crate::book::sfen::BookKey;
use crate::book::types::{
    BookHandleInput, BookInfo, BookMove, LookupBookMovesInput, OpenBookInput,
};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

/// 定跡を開いてハンドルを返す。
///
/// ファイルを読んで解析する処理なので、blocking プールへ逃がして
/// コマンドの async ランタイムを塞がないようにする。
///
/// 棋譜と違い、定跡はエンジン同梱のディレクトリや外付けドライブなど
/// プロジェクト root の外に置かれる。`file_system` の `validate_under_root` は
/// 当てられないので、代わりに [`validate_book_path`] で形だけを検査する。
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

    let opened = tauri::async_runtime::spawn_blocking(move || -> Result<_, BookError> {
        // 形式は利用者が指定した綴りの拡張子で決める。symlink の指す先で
        // 判別すると、`.db` を開いたつもりが別形式として読まれる。
        let reader = open_reader(&path)?;

        // 登録は実体のパスで行う。同じ定跡を別の綴りで開いたときに、
        // BookInfo.path が指すものが揃う。
        let canonical = std::fs::canonicalize(&path)
            .map_err(|e| BookError::from_io(e, path.to_string_lossy()))?;

        Ok((canonical, reader))
    })
    .await
    .map_err(join_error)?;

    let (canonical, reader) = opened?;

    Ok(state.register(canonical, reader))
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

    // NUL は OS のパス API で切り詰められるので、渡す前に弾く。
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

    // on-the-fly の reader はここでファイルを読むので、in-memory でも blocking 扱いに揃える。
    tauri::async_runtime::spawn_blocking(move || book.reader.lookup(&key))
        .await
        .map_err(join_error)?
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

    logged(
        "close_all_books",
        tauri::async_runtime::spawn_blocking(move || drop(sessions))
            .await
            .map_err(join_error),
    )?;

    Ok(closed)
}

/// 閉じる。ハンドルは以後 InvalidHandle になる。
///
/// 解放も blocking プールで行う。定跡の Drop は収録局面ぶんの `String` の解放に
/// なるので、IPC を受けたスレッドで走らせると閉じた瞬間に画面が固まる。
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

    tauri::async_runtime::spawn_blocking(move || drop(session))
        .await
        .map_err(join_error)
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

fn join_error(err: tauri::Error) -> BookError {
    BookError::new(
        BookErrorCode::Unknown,
        format!("定跡の処理が異常終了した: {err}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::reader::BookReader;
    use crate::book::types::BookFormat;

    struct FakeReader;

    impl BookReader for FakeReader {
        fn format(&self) -> BookFormat {
            BookFormat::YaneuraouDb
        }

        fn position_count(&self) -> u64 {
            0
        }

        fn lookup(&self, _key: &BookKey) -> Result<Vec<BookMove>, BookError> {
            Ok(Vec::new())
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
        let info = state.register(PathBuf::from("/books/a.db"), Box::new(FakeReader));
        drop(state.close(info.handle).unwrap());

        let err = resolve_lookup(&state, &lookup_input(info.handle, "壊れた局面")).unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidHandle);
    }

    #[test]
    fn reports_a_broken_position_for_a_live_handle() {
        let state = BookState::new();
        let info = state.register(PathBuf::from("/books/a.db"), Box::new(FakeReader));

        let err = resolve_lookup(&state, &lookup_input(info.handle, "壊れた局面")).unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidSfen);
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
