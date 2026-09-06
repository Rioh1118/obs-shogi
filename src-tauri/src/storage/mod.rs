//! 名前を付けたバイト列を置いて読み戻す。**永続の抽象。**
//!
//! **キャッシュは実装の詳細。** ここが約束するのは
//! 「置いた `key` で同じバイト列が返る」だけで、それが消えても作り直せるものか、
//! 消えては困るものかは呼び手が決める。
//!
//! 索引のチェックポイントは `search/cache/` がこの口を通す。
//! 定跡や解析結果を置くときも同じ口。
//!
//! | 実装 | どこへ | 消えるか |
//! | --- | --- | --- |
//! | [`DiskStore`] | 渡された根の下 | OS のキャッシュ置き場を渡せば消える |
//! | `InMemory` | メモリの上（テスト用。`cfg(test)` なので doc に出ない）| プロセスと一緒に |
//!
//! **差し替えられないと失敗の側を踏めない。** 「`rename` が落ちて本体が無い状態で
//! 終わる」はディスクの都合なので、テストからは起こせない。

mod codec;
mod disk;
#[cfg(test)]
mod in_memory;

pub use codec::{load, save, Codec, Zstd};
pub use disk::DiskStore;

/// OS のキャッシュ置き場に根を取った [`DiskStore`]。
///
/// **消えても作り直せるものだけを置く。** 設定やデータの側ではなく
/// 「キャッシュ」の側に置くので、OS に消されうる。
///
/// `AppHandle` に触るのはここだけ。呼び手は [`BlobStore`] を受ける。
pub fn app_cache(app: &tauri::AppHandle, area: &str) -> Result<DiskStore, StoreError> {
    use tauri::Manager;
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|e| StoreError::Io(e.to_string()))?
        .join("obs-shogi")
        .join(area);
    Ok(DiskStore::new(root))
}
#[cfg(test)]
pub use in_memory::InMemory;
/// 置けなかった・読めなかった理由。
#[derive(Debug)]
pub enum StoreError {
    /// まだ置かれていない。**復元では失敗ではない**（作り直せばよい）
    NotFound,
    /// ディスクの都合。権限・容量・使用中
    Io(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => write!(f, "not found"),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}

/// 名前を付けたバイト列の置き場。
///
/// **`key` は呼び手が決める名前。** 同じ `key` に置き直すと前のものは消える
/// （[`Self::save`] が Create と Update を兼ねる）。
///
/// [`Self::save`] は**途中の状態を読み手に見せない**こと。読んでいる最中に
/// 置き換えが走っても、読み手は前のものか新しいものかのどちらかを丸ごと得る。
///
/// **置き場を差し替えても同じ約束が成り立つこと。** どの実装も
/// `disk.rs` の `mod tests` にある `behaves_like_a_store` を通す。
/// 3つ目の実装を足すなら、そこへ1行足すこと。
pub trait BlobStore {
    /// 置く。同じ `key` があれば置き換える。
    fn save(&self, key: &str, bytes: &[u8]) -> Result<(), StoreError>;

    /// 読む。置かれていなければ [`StoreError::NotFound`]。
    fn load(&self, key: &str) -> Result<Vec<u8>, StoreError>;

    /// 捨てる。**置かれていなくても成功**（結果が同じなので）。
    ///
    /// 退避が残っていればそれも捨てる —— 捨てたはずのものが
    /// 次の [`Self::load`] で退避から戻ってこないため。
    fn delete(&self, key: &str) -> Result<(), StoreError>;
}
