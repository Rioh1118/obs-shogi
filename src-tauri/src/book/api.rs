use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::open_reader;
use crate::book::session::BookState;
use crate::book::sfen::to_book_key;
use crate::book::types::{
    BookHandleInput, BookInfo, BookMove, LookupBookMovesInput, OpenBookInput,
};
use std::path::PathBuf;
use tauri::State;

/// 定跡を開いてハンドルを返す。
///
/// 定跡は数百 MB になるので、読み込みは blocking プールへ逃がす。
#[tauri::command]
pub async fn open_book(
    state: State<'_, BookState>,
    input: OpenBookInput,
) -> Result<BookInfo, BookError> {
    let path = PathBuf::from(&input.path);
    log::info!("[cmd] open_book path={}", path.display());

    let reader = tauri::async_runtime::spawn_blocking(move || open_reader(&path))
        .await
        .map_err(join_error)??;

    Ok(state.register(input.path, reader))
}

/// 局面の候補手を引く。未収録なら空を返す。
#[tauri::command]
pub async fn lookup_book_moves(
    state: State<'_, BookState>,
    input: LookupBookMovesInput,
) -> Result<Vec<BookMove>, BookError> {
    let key = to_book_key(&input.sfen)?;
    let book = state.get(input.handle)?;

    // on-the-fly の reader はここでファイルを読むので、in-memory でも blocking 扱いに揃える。
    tauri::async_runtime::spawn_blocking(move || book.reader.lookup(&key))
        .await
        .map_err(join_error)?
}

/// 開いている定跡のメタ情報。
#[tauri::command]
pub fn get_book_info(
    state: State<'_, BookState>,
    input: BookHandleInput,
) -> Result<BookInfo, BookError> {
    Ok(state.get(input.handle)?.info.clone())
}

/// 閉じる。ハンドルは以後 InvalidHandle になる。
#[tauri::command]
pub fn close_book(state: State<'_, BookState>, input: BookHandleInput) -> Result<(), BookError> {
    log::info!("[cmd] close_book handle={}", input.handle);
    state.close(input.handle)
}

fn join_error(err: tauri::Error) -> BookError {
    BookError::new(
        BookErrorCode::Unknown,
        format!("定跡の処理がスレッドごと落ちた: {err}"),
    )
}
