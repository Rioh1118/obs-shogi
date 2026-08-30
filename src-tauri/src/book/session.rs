use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::{BookReader, OpenedBook};
use crate::book::types::{BookHandle, BookInfo};
use dashmap::DashMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// 開いている定跡ひとつ。
///
/// `open_book` コマンドの引数 `OpenBookInput` とは無関係。
pub(crate) struct BookSession {
    pub(crate) info: BookInfo,
    pub(crate) reader: Box<dyn BookReader>,
}

impl fmt::Debug for BookSession {
    // reader は形式ごとに中身が違い、ログに出しても意味を成さないので info だけ見せる。
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BookSession")
            .field("info", &self.info)
            .finish_non_exhaustive()
    }
}

/// 開いている定跡を束ねる Tauri State。
///
/// 同じ局面を複数の定跡で引き比べたい（#96）ので、1つに畳まずハンドルで並べて持つ。
/// 同じパスを2回開けば別のハンドルになる。
#[derive(Default)]
pub struct BookState {
    books: DashMap<BookHandle, Arc<BookSession>>,
    next_handle: AtomicU64,
    /// `get` が呼ばれた回数。呼び出し側が `Arc` を取る位置をテストで固定するために持つ。
    #[cfg(test)]
    get_calls: AtomicU64,
}

impl BookState {
    pub fn new() -> Self {
        Self::default()
    }

    /// reader を預かってハンドルを振る。
    ///
    /// 材料は [`OpenedBook`] としてまとめて受け取る。`format` と `position_count` を
    /// reader に問い合わせないのは、この関数が async ランタイム上で走るため
    /// （詳細は [`OpenedBook`] の doc）。
    ///
    /// ハンドルは 0 から始めない。フロントの未初期化値と衝突しないため。
    /// 閉じたハンドルも配り直さない。再利用すると、close 済みのハンドルで引いた
    /// 呼び出しが別の定跡に静かに当たる。
    pub(crate) fn register(&self, opened: OpenedBook) -> BookInfo {
        let handle = self.next_handle.fetch_add(1, Ordering::Relaxed) + 1;

        let info = BookInfo {
            handle,
            path: opened.path.to_string_lossy().into_owned(),
            format: opened.format,
            position_count: opened.position_count,
        };

        self.books.insert(
            handle,
            Arc::new(BookSession {
                info: info.clone(),
                reader: opened.reader,
            }),
        );

        info
    }

    /// ハンドルの指す定跡のメタ情報だけを返す。
    ///
    /// `Arc` を持ち出さないので、呼び出し側が最後の参照になることが無い。
    /// メタ情報を見るだけの経路はこちらを使うこと。
    pub(crate) fn info(&self, handle: BookHandle) -> Result<BookInfo, BookError> {
        self.books
            .get(&handle)
            .map(|entry| entry.value().info.clone())
            .ok_or_else(|| Self::invalid_handle(handle, "開き直すこと"))
    }

    /// ハンドルの指す定跡を取り出す。
    ///
    /// map のロックを跨いで読ませないために `Arc` を複製して返す。返した `Arc` が
    /// 生きている間は、close されても reader は解放されない。引いている最中に
    /// 閉じられても落ちないための性質で、長く持ち回るとその間メモリが残る。
    ///
    /// **最後の参照になりうるので、落とす場所は blocking プールにすること。**
    /// async ランタイム上で落とすと、reader の Drop がそこで走る。
    pub(crate) fn get(&self, handle: BookHandle) -> Result<Arc<BookSession>, BookError> {
        #[cfg(test)]
        self.get_calls.fetch_add(1, Ordering::Relaxed);

        self.books
            .get(&handle)
            .map(|entry| Arc::clone(entry.value()))
            .ok_or_else(|| Self::invalid_handle(handle, "開き直すこと"))
    }

    /// 閉じて、外した定跡そのものを返す。
    ///
    /// 知らないハンドルを黙って成功させないのは、二重 close やハンドルの取り違えが
    /// フロント側で検出できなくなるため。
    ///
    /// 返り値を捨てるとその場で reader が Drop される。メモリに展開する reader では
    /// 収録局面ぶんの解放になるので、捨てる場所は呼び出し側が選ぶ。
    #[must_use = "捨てた場所で reader の Drop が走る。どこで解放するかを選ぶこと"]
    pub(crate) fn close(&self, handle: BookHandle) -> Result<Arc<BookSession>, BookError> {
        self.books
            .remove(&handle)
            .map(|(_, session)| session)
            // 閉じたいのに「開き直せ」と言われると、指示に従うと閉じたはずの
            // 定跡が載り直す。close にとって未知のハンドルは、目的が既に達成された状態。
            .ok_or_else(|| Self::invalid_handle(handle, "既に閉じられているので操作は要らない"))
    }

    /// 開いている定跡を、ハンドルの若い順に返す。
    ///
    /// ハンドルはフロントの変数にしか無いので、webview が作り直されると
    /// close を呼べる者が居なくなる。ここから孤児を見つけて閉じられるようにする。
    pub(crate) fn list(&self) -> Vec<BookInfo> {
        let mut infos: Vec<BookInfo> = self
            .books
            .iter()
            .map(|entry| entry.value().info.clone())
            .collect();
        infos.sort_by_key(|info| info.handle);
        infos
    }

    /// 全部閉じて、外した定跡を返す。
    #[must_use = "捨てた場所で reader の Drop が走る。どこで解放するかを選ぶこと"]
    pub(crate) fn close_all(&self) -> Vec<Arc<BookSession>> {
        // dashmap は map への参照を握ったまま remove を呼ぶと deadlock しうる
        // （dashmap 6.1.0 の DashMap::remove の doc）。キーを取り切って iter を
        // 終わらせてから外す。1段に畳むとコマンドがアプリを固める。
        let handles: Vec<BookHandle> = self.books.iter().map(|entry| *entry.key()).collect();
        handles
            .into_iter()
            .filter_map(|handle| self.books.remove(&handle).map(|(_, session)| session))
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn get_calls(&self) -> u64 {
        self.get_calls.load(Ordering::Relaxed)
    }

    // 開いている件数は、外へは list で出す。この2つは leak を見るテスト用。
    #[cfg(test)]
    fn len(&self) -> usize {
        self.books.len()
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.books.is_empty()
    }

    /// `recovery` は呼び出し側から渡す。閉じようとしたのか引こうとしたのかで、
    /// 次にやるべきことが逆になる。
    fn invalid_handle(handle: BookHandle, recovery: &'static str) -> BookError {
        BookError::new(
            BookErrorCode::InvalidHandle,
            format!("この定跡は閉じられている。{recovery}（ハンドル {handle}）"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::sfen::BookKey;
    use crate::book::types::{BookFormat, BookMove};
    use std::path::PathBuf;
    use std::sync::atomic::AtomicUsize;

    /// Drop まで観測したいので、生存数を外の counter に持たせる。
    struct FakeReader {
        alive: Arc<AtomicUsize>,
    }

    impl FakeReader {
        fn boxed(alive: &Arc<AtomicUsize>) -> Box<dyn BookReader> {
            alive.fetch_add(1, Ordering::SeqCst);
            Box::new(Self {
                alive: Arc::clone(alive),
            })
        }
    }

    impl Drop for FakeReader {
        fn drop(&mut self) {
            self.alive.fetch_sub(1, Ordering::SeqCst);
        }
    }

    // 収録局面数は trait に無いので、`register` が reader に問い合わせる形は
    // コンパイルが通らない。ここで値を細工して見張る必要は無い。
    impl BookReader for FakeReader {
        fn lookup(&self, _key: &BookKey) -> Result<Vec<BookMove>, BookError> {
            Ok(Vec::new())
        }
    }

    /// register に渡す材料。テストが見るのは path と reader だけ。
    fn opened(path: &str, alive: &Arc<AtomicUsize>) -> OpenedBook {
        OpenedBook {
            path: PathBuf::from(path),
            format: BookFormat::YaneuraouDb,
            position_count: Some(3),
            reader: FakeReader::boxed(alive),
        }
    }

    fn state_with_one_book() -> (BookState, Arc<AtomicUsize>, BookInfo) {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        let info = state.register(opened("/books/a.db", &alive));
        (state, alive, info)
    }

    #[test]
    fn register_fills_the_info_from_the_opened_book() {
        let (_state, _alive, info) = state_with_one_book();
        assert_eq!(info.path, "/books/a.db");
        assert_eq!(info.format, BookFormat::YaneuraouDb);
        assert_eq!(info.position_count, Some(3));
        assert!(info.handle > 0);
    }

    #[test]
    fn handles_are_distinct_even_for_the_same_path() {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        let first = state.register(opened("/books/a.db", &alive));
        let second = state.register(opened("/books/a.db", &alive));

        assert_ne!(first.handle, second.handle);
        assert_eq!(state.len(), 2);
    }

    #[test]
    fn get_returns_the_registered_book() {
        let (state, _alive, info) = state_with_one_book();
        let book = state.get(info.handle).unwrap();
        assert_eq!(book.info, info);
    }

    #[test]
    fn get_rejects_an_unknown_handle() {
        let (state, _alive, info) = state_with_one_book();
        let err = state.get(info.handle + 1).unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidHandle);
    }

    #[test]
    fn close_rejects_an_already_closed_handle() {
        let (state, _alive, info) = state_with_one_book();
        drop(state.close(info.handle).unwrap());

        let err = state.close(info.handle).unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidHandle);
        // 閉じたい相手に「開き直せ」と言わないこと
        assert!(
            !err.message().contains("開き直す"),
            "message={}",
            err.message()
        );
    }

    /// 引くのもメタ情報を見るのも、復帰操作は開き直すこと。
    /// 閉じようとしたときだけ逆になる（`close_rejects_an_already_closed_handle`）。
    #[test]
    fn reading_a_closed_handle_says_to_open_it_again() {
        let (state, _alive, info) = state_with_one_book();
        drop(state.close(info.handle).unwrap());

        for err in [
            state.get(info.handle).unwrap_err(),
            state.info(info.handle).unwrap_err(),
        ] {
            assert_eq!(err.code(), BookErrorCode::InvalidHandle);
            assert!(
                err.message().contains("開き直す"),
                "message={}",
                err.message()
            );
        }
    }

    /// メタ情報だけを見る経路は Arc を持ち出さない。持ち出すと、その参照が
    /// 最後の1つになったとき reader の Drop が呼び出し側のスレッドで走る。
    #[test]
    fn info_returns_the_same_values_as_the_session() {
        let (state, _alive, expected) = state_with_one_book();
        assert_eq!(state.info(expected.handle).unwrap(), expected);
    }

    #[test]
    fn a_closed_handle_is_not_handed_out_again() {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        let first = state.register(opened("/books/a.db", &alive));
        drop(state.close(first.handle).unwrap());

        let second = state.register(opened("/books/b.db", &alive));
        assert_ne!(first.handle, second.handle);
        assert_eq!(
            state.get(first.handle).unwrap_err().code(),
            BookErrorCode::InvalidHandle
        );
    }

    /// 受入条件「多重に開いて閉じても leak しない」。件数だけでなく reader が
    /// Drop されたことまで見る。
    #[test]
    fn closing_every_book_drops_every_reader() {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));

        let handles: Vec<BookHandle> = (0..32)
            .map(|i| {
                state
                    .register(opened(&format!("/books/{i}.db"), &alive))
                    .handle
            })
            .collect();

        assert_eq!(state.len(), 32);
        assert_eq!(alive.load(Ordering::SeqCst), 32);

        for handle in handles {
            drop(state.close(handle).unwrap());
        }

        assert!(state.is_empty());
        assert_eq!(alive.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn list_returns_every_open_book_in_handle_order() {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        let first = state.register(opened("/books/a.db", &alive));
        let second = state.register(opened("/books/b.db", &alive));

        assert_eq!(state.list(), vec![first.clone(), second]);

        drop(state.close(first.handle).unwrap());
        assert_eq!(state.list().len(), 1);
    }

    /// ハンドルを失ったフロントが回収できる経路。全て Drop まで行くこと。
    #[test]
    fn close_all_drops_every_reader() {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        for i in 0..8 {
            state.register(opened(&format!("/books/{i}.db"), &alive));
        }

        let closed = state.close_all();

        assert_eq!(closed.len(), 8);
        assert!(state.is_empty());
        assert!(state.list().is_empty());
        assert_eq!(alive.load(Ordering::SeqCst), 8, "返した間はまだ生きている");

        drop(closed);
        assert_eq!(alive.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn close_all_on_an_empty_state_is_not_an_error() {
        let state = BookState::new();
        assert!(state.close_all().is_empty());
    }

    /// `get` が返した `Arc` を持ったまま閉じても、参照が消えれば Drop まで行く。
    #[test]
    fn a_live_reference_does_not_keep_the_reader_forever() {
        let (state, alive, info) = state_with_one_book();

        let held = state.get(info.handle).unwrap();
        drop(state.close(info.handle).unwrap());
        assert_eq!(alive.load(Ordering::SeqCst), 1);

        drop(held);
        assert_eq!(alive.load(Ordering::SeqCst), 0);
    }
}
