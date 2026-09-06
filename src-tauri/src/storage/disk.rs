//! ディスクに、tmp → rename で置く。
//!
//! **消えてよいかは根の渡し方で決まる。** OS のキャッシュ置き場を渡せば
//! 消されうるし、データの置き場を渡せば残る。ここはその判断を持たない。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{BlobStore, StoreError};

/// 渡された根の下に、`key` ごとのファイルを置く。
pub struct DiskStore {
    root: PathBuf,
}

impl DiskStore {
    /// `root` の下に `key` ごとのファイルを置く。
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 本体 / 退避 / 作業中 の3つ。
    ///
    /// **退避が要るのは Windows で上書き rename が失敗するため。**
    /// 本体を退避へ動かしてから置くので、**読む側は本体 → 退避の順に2回試す**。
    fn paths(&self, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let base = self.root.join(key);
        (
            base.with_extension("blob"),
            base.with_extension("bak"),
            base.with_extension("tmp"),
        )
    }
}

impl BlobStore for DiskStore {
    /// tmp へ書き切ってから rename する。**途中の状態は読み手に見えない。**
    fn save(&self, key: &str, bytes: &[u8]) -> Result<(), StoreError> {
        let (final_path, bak, tmp) = self.paths(key);
        let io = |e: std::io::Error| StoreError::Io(e.to_string());

        if let Some(dir) = final_path.parent() {
            fs::create_dir_all(dir).map_err(io)?;
        }

        {
            let mut out = fs::File::create(&tmp).map_err(io)?;
            out.write_all(bytes).map_err(io)?;
            out.flush().map_err(io)?;
        }

        // 本体があれば退避してから置く
        if final_path.exists() {
            let _ = fs::remove_file(&bak);
            fs::rename(&final_path, &bak).map_err(io)?;
        }
        fs::rename(&tmp, &final_path).map_err(io)?;

        // ここまで来たら退避は要らない。**消せなくても失敗にしない** ——
        // 本体は置けているので、次に読むのは本体
        let _ = fs::remove_file(&bak);
        Ok(())
    }

    /// 本体 → 退避の順に読む。
    ///
    /// 本体の rename が落ちた直後だけ退避が残っていて、そこには**1つ前のもの**が入る。
    fn load(&self, key: &str) -> Result<Vec<u8>, StoreError> {
        let (final_path, bak, _) = self.paths(key);
        match read(&final_path) {
            Ok(v) => Ok(v),
            Err(StoreError::NotFound) if bak.exists() => read(&bak),
            Err(e) => {
                if bak.exists() {
                    read(&bak)
                } else {
                    Err(e)
                }
            }
        }
    }

    /// 本体・退避・作業中の3つを消す。
    ///
    /// **退避も消す。** 残すと次の `load` がそこから戻してしまう。
    fn delete(&self, key: &str) -> Result<(), StoreError> {
        let (final_path, bak, tmp) = self.paths(key);
        for p in [final_path, bak, tmp] {
            match fs::remove_file(&p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(StoreError::Io(e.to_string())),
            }
        }
        Ok(())
    }
}

fn read(p: &Path) -> Result<Vec<u8>, StoreError> {
    match fs::read(p) {
        Ok(v) => Ok(v),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(StoreError::NotFound),
        Err(e) => Err(StoreError::Io(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::InMemory;

    fn tmp_root(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("obs-shogi-blob-{name}"));
        let _ = fs::remove_dir_all(&d);
        d
    }

    /// **どの置き場も同じ約束を守ること。**
    ///
    /// 置いて読める・置き直すと前が消える・無いものは `NotFound`・
    /// 捨てたら読めない・無いものを捨てても成功。
    fn behaves_like_a_store(store: &dyn BlobStore) {
        assert!(matches!(store.load("k"), Err(StoreError::NotFound)));

        store.save("k", b"first").expect("置けない");
        assert_eq!(store.load("k").expect("読めない"), b"first");

        store.save("k", b"second").expect("置き直せない");
        assert_eq!(store.load("k").expect("読めない"), b"second");

        store.delete("k").expect("捨てられない");
        assert!(
            matches!(store.load("k"), Err(StoreError::NotFound)),
            "捨てたのに読めている"
        );

        store.delete("k").expect("無いものを捨てて失敗した");
    }

    #[test]
    fn the_disk_store_keeps_the_promise() {
        behaves_like_a_store(&DiskStore::new(tmp_root("promise")));
    }

    #[test]
    fn the_in_memory_store_keeps_the_promise() {
        behaves_like_a_store(&InMemory::new());
    }

    /// **本体が消えても、退避に1つ前が残っていれば読める。**
    ///
    /// 本体への rename が落ちた直後がこの形。
    #[test]
    fn a_missing_blob_falls_back_to_the_previous_one() {
        let root = tmp_root("fallback");
        let store = DiskStore::new(root.clone());
        store.save("k", b"only").expect("置けない");

        fs::copy(root.join("k.blob"), root.join("k.bak")).expect("退避を作れない");
        fs::remove_file(root.join("k.blob")).expect("本体を消せない");

        assert_eq!(store.load("k").expect("退避から読めない"), b"only");
    }

    /// **捨てたら退避からも戻らない。**
    ///
    /// 退避を残すと、捨てたはずのものが次の `load` で戻る。
    #[test]
    fn deleting_also_drops_the_fallback() {
        let root = tmp_root("delete-bak");
        let store = DiskStore::new(root.clone());
        store.save("k", b"only").expect("置けない");
        fs::copy(root.join("k.blob"), root.join("k.bak")).expect("退避を作れない");

        store.delete("k").expect("捨てられない");

        assert!(
            matches!(store.load("k"), Err(StoreError::NotFound)),
            "退避から戻ってきている"
        );
    }

    /// **失敗する置き場は、置くと落ちる。**
    ///
    /// ディスクの失敗はテストから起こせないので、仕込める置き場で踏む。
    #[test]
    fn a_failing_store_reports_the_failure() {
        assert!(matches!(
            InMemory::failing().save("k", b"x"),
            Err(StoreError::Io(_))
        ));
    }
}
