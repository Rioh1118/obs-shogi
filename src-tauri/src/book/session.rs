use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::BookReader;
use crate::book::types::{BookHandle, BookInfo};
use dashmap::DashMap;
use std::fmt;
use std::path::PathBuf;
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
}

impl BookState {
    pub fn new() -> Self {
        Self::default()
    }

    /// reader を預かってハンドルを振る。
    ///
    /// `path` は canonicalize 済みのものを渡すこと（`BookInfo::path` の意味）。
    /// 文字列で受けると、組み立てた綴りをそのまま渡す経路が型検査を素通りする。
    ///
    /// ハンドルは 0 から始めない。フロントの未初期化値と衝突しないため。
    /// 閉じたハンドルも配り直さない。再利用すると、close 済みのハンドルで引いた
    /// 呼び出しが別の定跡に静かに当たる。
    pub(crate) fn register(&self, path: PathBuf, reader: Box<dyn BookReader>) -> BookInfo {
        let handle = self.next_handle.fetch_add(1, Ordering::Relaxed) + 1;

        let info = BookInfo {
            handle,
            path: path.to_string_lossy().into_owned(),
            format: reader.format(),
            position_count: reader.position_count(),
        };

        self.books.insert(
            handle,
            Arc::new(BookSession {
                info: info.clone(),
                reader,
            }),
        );

        info
    }

    /// ハンドルの指す定跡を取り出す。
    ///
    /// map のロックを跨いで読ませないために `Arc` を複製して返す。返した `Arc` が
    /// 生きている間は、close されても reader は解放されない。引いている最中に
    /// 閉じられても落ちないための性質で、長く持ち回るとその間メモリが残る。
    pub(crate) fn get(&self, handle: BookHandle) -> Result<Arc<BookSession>, BookError> {
        self.books
            .get(&handle)
            .map(|entry| Arc::clone(entry.value()))
            .ok_or_else(|| Self::invalid_handle(handle))
    }

    /// 閉じて、外した定跡そのものを返す。
    ///
    /// 知らないハンドルを黙って成功させないのは、二重 close やハンドルの取り違えが
    /// フロント側で検出できなくなるため。
    ///
    /// 返り値を捨てるとその場で reader が Drop される。数百万個の `String` の解放が
    /// 走るので、捨てる場所は呼び出し側が選ぶ。
    #[must_use = "捨てた場所で reader の Drop が走る。どこで解放するかを選ぶこと"]
    pub(crate) fn close(&self, handle: BookHandle) -> Result<Arc<BookSession>, BookError> {
        self.books
            .remove(&handle)
            .map(|(_, session)| session)
            .ok_or_else(|| Self::invalid_handle(handle))
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
        let handles: Vec<BookHandle> = self.books.iter().map(|entry| *entry.key()).collect();
        handles
            .into_iter()
            .filter_map(|handle| self.books.remove(&handle).map(|(_, session)| session))
            .collect()
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

    fn invalid_handle(handle: BookHandle) -> BookError {
        BookError::new(
            BookErrorCode::InvalidHandle,
            format!("定跡ハンドル {handle} は開かれていない"),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::sfen::BookKey;
    use crate::book::types::{BookFormat, BookMove};
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

    impl BookReader for FakeReader {
        fn format(&self) -> BookFormat {
            BookFormat::YaneuraouDb
        }

        fn position_count(&self) -> u64 {
            3
        }

        fn lookup(&self, _key: &BookKey) -> Result<Vec<BookMove>, BookError> {
            Ok(Vec::new())
        }
    }

    fn state_with_one_book() -> (BookState, Arc<AtomicUsize>, BookInfo) {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        let info = state.register(PathBuf::from("/books/a.db"), FakeReader::boxed(&alive));
        (state, alive, info)
    }

    #[test]
    fn register_fills_the_info_from_the_reader() {
        let (_state, _alive, info) = state_with_one_book();
        assert_eq!(info.path, "/books/a.db");
        assert_eq!(info.format, BookFormat::YaneuraouDb);
        assert_eq!(info.position_count, 3);
        assert!(info.handle > 0);
    }

    #[test]
    fn handles_are_distinct_even_for_the_same_path() {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        let first = state.register(PathBuf::from("/books/a.db"), FakeReader::boxed(&alive));
        let second = state.register(PathBuf::from("/books/a.db"), FakeReader::boxed(&alive));

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
        assert_eq!(err.code, BookErrorCode::InvalidHandle);
    }

    #[test]
    fn close_rejects_an_already_closed_handle() {
        let (state, _alive, info) = state_with_one_book();
        drop(state.close(info.handle).unwrap());

        let err = state.close(info.handle).unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidHandle);
    }

    #[test]
    fn a_closed_handle_is_not_handed_out_again() {
        let state = BookState::new();
        let alive = Arc::new(AtomicUsize::new(0));
        let first = state.register(PathBuf::from("/books/a.db"), FakeReader::boxed(&alive));
        drop(state.close(first.handle).unwrap());

        let second = state.register(PathBuf::from("/books/b.db"), FakeReader::boxed(&alive));
        assert_ne!(first.handle, second.handle);
        assert_eq!(
            state.get(first.handle).unwrap_err().code,
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
                    .register(
                        PathBuf::from(format!("/books/{i}.db")),
                        FakeReader::boxed(&alive),
                    )
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
        let first = state.register(PathBuf::from("/books/a.db"), FakeReader::boxed(&alive));
        let second = state.register(PathBuf::from("/books/b.db"), FakeReader::boxed(&alive));

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
            state.register(
                PathBuf::from(format!("/books/{i}.db")),
                FakeReader::boxed(&alive),
            );
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
