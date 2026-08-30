use crate::book::error::{truncate_path, BookError, BookErrorCode};
use crate::book::open::{open_at, validate_book_path};
use crate::book::session::BookSession;
use crate::book::session::BookState;
use crate::book::sfen::to_book_key;
use crate::book::sfen::BookKey;
use crate::book::types::{
    BookHandleInput, BookInfo, BookMove, LookupBookMovesInput, OpenBookInput,
};
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
/// 何をどの順に検査するかは `open` モジュールにある（ここへ写すと必ず片方が腐る）。
/// 全て通っても、その形式の reader を持っていなければ `UnsupportedFormat` になる。
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
    //
    // 長さの打ち切りは BookError の with_path が持っているが、ログは
    // BookError を通らないのでここで明示的に掛ける。
    let path = validate_book_path(&input.path)?;
    log::info!("[cmd] open_book path={}", truncate_path(&input.path));

    let opened = tauri::async_runtime::spawn_blocking(move || open_at(&path))
        .await
        .map_err(join_error(input.path, "もう一度開き直すこと"))?;

    Ok(state.register(opened?))
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
    use crate::book::reader::{BookReader, OpenedBook};
    use crate::book::types::BookFormat;
    use std::path::PathBuf;

    struct FakeReader;

    impl BookReader for FakeReader {
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
        assert_eq!(err.code(), BookErrorCode::InvalidHandle);
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

        assert_eq!(err.code(), BookErrorCode::InvalidSfen);
        assert_eq!(state.get_calls(), 0);
    }
}
