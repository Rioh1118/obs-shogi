use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::BookReader;
use crate::book::types::{BookHandle, BookInfo};
use dashmap::DashMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// 開いている定跡ひとつ。
///
/// `open_book` コマンドの引数 `OpenBookInput` とは無関係。
pub struct BookSession {
    pub info: BookInfo,
    pub reader: Box<dyn BookReader>,
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
    pub fn register(&self, path: String, reader: Box<dyn BookReader>) -> BookInfo {
        // 0 を配らないので、フロントの未初期化値と衝突しない。
        // 閉じたハンドルを配り直すこともしないので、close 済みのハンドルで引くと
        // 別の定跡に当たるのではなく必ず InvalidHandle になる。
        let handle = self.next_handle.fetch_add(1, Ordering::Relaxed) + 1;

        let info = BookInfo {
            handle,
            path,
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
    /// map のロックを跨いで読ませないために `Arc` を複製して返す。
    pub fn get(&self, handle: BookHandle) -> Result<Arc<BookSession>, BookError> {
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
    pub fn close(&self, handle: BookHandle) -> Result<Arc<BookSession>, BookError> {
        self.books
            .remove(&handle)
            .map(|(_, session)| session)
            .ok_or_else(|| Self::invalid_handle(handle))
    }

    /// 開いている定跡の数。
    pub fn len(&self) -> usize {
        self.books.len()
    }

    pub fn is_empty(&self) -> bool {
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
        let info = state.register("/books/a.db".to_string(), FakeReader::boxed(&alive));
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
        let first = state.register("/books/a.db".to_string(), FakeReader::boxed(&alive));
        let second = state.register("/books/a.db".to_string(), FakeReader::boxed(&alive));

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
        let first = state.register("/books/a.db".to_string(), FakeReader::boxed(&alive));
        drop(state.close(first.handle).unwrap());

        let second = state.register("/books/b.db".to_string(), FakeReader::boxed(&alive));
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
                    .register(format!("/books/{i}.db"), FakeReader::boxed(&alive))
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
