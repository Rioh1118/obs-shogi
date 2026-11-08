//! 名前を付けたバイト列を置いて読み戻す、永続の抽象。
//!
//! ここが約束するのは「置いた `key` で同じバイト列が返る」だけ。消えても作り直せるものか、
//! 消えては困るものかは呼び手が決める。キャッシュの置き場に置くかどうかは実装の詳細。
//!
//! 今の呼び手は索引のチェックポイント（`search/cache/format.rs`）だけ。
//!
//! | 実装 | どこへ | 消えるか |
//! | --- | --- | --- |
//! | [`DiskStore`] | 渡された根の下 | OS のキャッシュ置き場を渡せば消える |
//! | `InMemory` | メモリの上（テスト用。`cfg(test)` なので doc に出ない）| プロセスと一緒に |
//!
//! 置き場を trait にするのは、読み手のテストがディスクを使わずに置けない失敗を踏むため。
//! 索引のテスト（`search/cache/format.rs`）は `InMemory::failing` に差し替えて踏む。

use std::path::PathBuf;

mod codec;
mod disk;
#[cfg(test)]
mod in_memory;

pub use codec::{load, save, Codec, Zstd};
pub use disk::DiskStore;
#[cfg(test)]
pub use in_memory::InMemory;

/// OS のキャッシュ置き場の下の `obs-shogi/<area>` に根を取った [`DiskStore`]。
///
/// OS に消されうるので、消えても作り直せるものだけを置く。
///
/// `AppHandle` に触るのはここだけ。読み書きする関数（`search/cache/format.rs`）は
/// [`BlobStore`] を受けるので、テストでは `InMemory` を渡せる。
pub fn app_cache(app: &tauri::AppHandle, area: &str) -> Result<DiskStore, StoreError> {
    use tauri::Manager;
    let app_cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| StoreError::Io(e.to_string()))?;
    Ok(DiskStore::new(cache_root(app_cache_dir, area)))
}

/// [`app_cache`] の根。綴りを変えると、利用者のディスクにある前のキャッシュを読めなくなる。
fn cache_root(app_cache_dir: PathBuf, area: &str) -> PathBuf {
    app_cache_dir.join("obs-shogi").join(area)
}

/// 置けなかった、読めなかった理由
#[derive(Debug)]
pub enum StoreError {
    /// まだ置かれていない。復元では失敗ではなく、作り直せばよい
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

/// 名前を付けたバイト列の置き場
///
/// `key` は呼び手が決める名前で、同じ `key` に置き直すと前のものは消える
/// （[`Self::save`] が作成と更新を兼ねる）。
///
/// [`Self::save`] は途中の状態を読み手に見せない。読んでいる最中に置き換えが走っても、
/// 読み手は前のものか新しいものかのどちらかを丸ごと得る。
///
/// どの実装も `disk.rs` の `mod tests` にある `behaves_like_a_store` を通す。
/// 実装を足すなら、そこへ1行足すこと。
pub trait BlobStore {
    /// 置く。同じ `key` があれば置き換える。
    fn save(&self, key: &str, bytes: &[u8]) -> Result<(), StoreError>;

    /// 読む。置かれていなければ [`StoreError::NotFound`]。
    fn load(&self, key: &str) -> Result<Vec<u8>, StoreError>;

    /// 捨てる。置かれていなくても、結果が同じなので成功する。
    ///
    /// 捨てた後の [`Self::load`] は `NotFound` を返す。写し（`DiskStore` の退避）を持つ実装は
    /// 写しも捨てる。残すと、捨てたはずのものが写しから戻る。
    fn delete(&self, key: &str) -> Result<(), StoreError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 根は `<app_cache_dir>/obs-shogi/<area>`。綴りが変わると、前の索引のキャッシュを読めず全件の構築へ落ちる。
    #[test]
    fn the_cache_root_is_under_the_app_name_and_the_area() {
        assert_eq!(
            cache_root(PathBuf::from("/cache"), "index"),
            PathBuf::from("/cache/obs-shogi/index")
        );
    }
}
