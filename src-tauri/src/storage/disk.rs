//! ディスクに、作業中のファイルへ書き切ってから rename で置く。
//!
//! 消えてよいかは根の渡し方で決まる。OS のキャッシュ置き場を渡せば消されうるし、
//! データの置き場を渡せば残る。ここはその判断を持たない。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::{BlobStore, StoreError};

/// 渡された根の下に、`key` ごとのファイルを置く。
pub struct DiskStore {
    root: PathBuf,
}

impl DiskStore {
    /// `root` を根にする。根は最初に置くときに作る。
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 本体、退避、作業中の3つのパス。名前は `<key>.blob`、`<key>.bak`、`<key>.tmp`。
    ///
    /// 退避を挟むのは、Windows で上書きの rename が失敗するため。本体を退避へ動かしてから
    /// 置くので、読む側は本体、退避の順に試す。
    fn paths(&self, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let path = |extension: &str| self.root.join(format!("{key}.{extension}"));
        (path("blob"), path("bak"), path("tmp"))
    }
}

impl BlobStore for DiskStore {
    /// 作業中のファイルへ書き切り、耐久化してから本体へ rename する。途中の状態は読み手に見えない。
    fn save(&self, key: &str, bytes: &[u8]) -> Result<(), StoreError> {
        let (final_path, bak, tmp) = self.paths(key);
        let io = |e: std::io::Error| StoreError::Io(e.to_string());

        if let Some(dir) = final_path.parent() {
            fs::create_dir_all(dir).map_err(io)?;
        }

        {
            let mut out = fs::File::create(&tmp).map_err(io)?;
            out.write_all(bytes).map_err(io)?;
            // `std::fs::File` の `flush` は何もせず、中身はページキャッシュにあるだけ。
            // ここで耐久化しないと、置き換えの直後に OS ごと落ちたとき**本体は在るのに中身が空**になる
            out.sync_all().map_err(io)?;
        }

        // 本体があれば退避してから置く
        if final_path.exists() {
            let _ = fs::remove_file(&bak);
            fs::rename(&final_path, &bak).map_err(io)?;
        }
        fs::rename(&tmp, &final_path).map_err(io)?;

        // 本体は置けているので、次に読むのは本体。退避を消せなくても失敗にしない
        let _ = fs::remove_file(&bak);
        Ok(())
    }

    /// 本体を読み、読めなければ退避を読む。
    ///
    /// 退避に値が在るのは次のときで、どれも中身は1つ前の値。
    ///
    /// - 置き直しの途中（本体を退避へ動かしてから退避を消すまで）
    /// - 本体への rename が落ちた後
    /// - 置き直しの最後に退避を消せなかった後
    ///
    /// 中身は確かめない。本体が読めれば、復号できない中身でも返し、退避へは落ちない。
    /// 復号の成否はバイト列を返すここでは分からないので、呼び手が決める。
    /// [`Self::save`] は書き切って耐久化してから rename するので、書きかけの本体は残らない。
    fn load(&self, key: &str) -> Result<Vec<u8>, StoreError> {
        let (final_path, bak, _) = self.paths(key);
        match read(&final_path) {
            Ok(v) => Ok(v),
            Err(_) if bak.exists() => read(&bak),
            Err(e) => Err(e),
        }
    }

    /// 本体、退避、作業中の3つを消す。退避を残すと、次の `load` がそこから戻す。
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

    // 名前を固定しない。`std::env::temp_dir()` はワークツリーをまたいで共有され、
    // worktree を並べて `verify:rust` を同時に走らせると片方の後片付けが
    // もう片方の実体を消す（`tests/temp_dir_names.rs` が見ている）。
    fn tmp_root(name: &str) -> PathBuf {
        test_support::dir::temp_dir(&format!("blob-{name}"))
    }

    /// [`BlobStore`] の約束。どの置き場もこれを通す。
    ///
    /// - 置いたものを読める
    /// - 置き直すと前のものが消える
    /// - 無いものは `NotFound`
    /// - 捨てたら読めない
    /// - 無いものを捨てても成功する
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

    /// 本体が消えても、退避に1つ前が残っていれば読める。本体への rename が落ちた後がこの形。
    #[test]
    fn a_missing_blob_falls_back_to_the_previous_one() {
        let root = tmp_root("fallback");
        let store = DiskStore::new(root.clone());
        store.save("k", b"only").expect("置けない");

        fs::copy(root.join("k.blob"), root.join("k.bak")).expect("退避を作れない");
        fs::remove_file(root.join("k.blob")).expect("本体を消せない");

        assert_eq!(store.load("k").expect("退避から読めない"), b"only");
    }

    /// 捨てたら退避からも戻らない。退避を残すと、捨てたはずのものが次の `load` で戻る。
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

    /// 別の `key` に置いたものは、互いを上書きしない。
    #[test]
    fn two_keys_do_not_share_a_file() {
        let store = DiskStore::new(tmp_root("two-keys"));
        store.save("a", b"for a").expect("置けない");
        store.save("b", b"for b").expect("置けない");

        assert_eq!(store.load("a").expect("読めない"), b"for a");
        assert_eq!(store.load("b").expect("読めない"), b"for b");
    }

    /// `.` を含む `key` も、`.` の後ろまで含めて別の名前として扱う。
    ///
    /// 拡張子を付け替える形だと、`x.1` と `x.2` が同じ `x.blob` を使い、後に置いた方が前を消す。
    #[test]
    fn keys_that_differ_after_a_dot_do_not_share_a_file() {
        let store = DiskStore::new(tmp_root("dotted-keys"));
        store.save("x.1", b"one").expect("置けない");
        store.save("x.2", b"two").expect("置けない");

        assert_eq!(store.load("x.1").expect("読めない"), b"one");
        assert_eq!(store.load("x.2").expect("読めない"), b"two");
    }

    /// 根がまだ無くても置ける。OS のキャッシュ置き場の下は、初回の起動では空。
    #[test]
    fn saving_creates_the_root() {
        let root = tmp_root("no-root").join("obs-shogi").join("index");
        let store = DiskStore::new(root);

        store.save("k", b"x").expect("根が無いと置けない");
        assert_eq!(store.load("k").expect("読めない"), b"x");
    }

    /// 置き直し終えたら、退避も作業中のファイルも残らない。残ると、読まない値が根の下を占め続ける。
    #[test]
    fn saving_again_leaves_no_fallback_behind() {
        let root = tmp_root("no-bak");
        let store = DiskStore::new(root.clone());
        store.save("k", b"first").expect("置けない");
        store.save("k", b"second").expect("置き直せない");

        assert!(!root.join("k.bak").exists(), "退避が残っている");
        assert!(!root.join("k.tmp").exists(), "作業中のファイルが残っている");
    }

    /// 捨てると、書きかけで残った作業中のファイルも消える。
    #[test]
    fn deleting_also_drops_a_leftover_temporary() {
        let root = tmp_root("delete-tmp");
        let store = DiskStore::new(root.clone());
        fs::write(root.join("k.tmp"), b"half").expect("作業中のファイルを作れない");

        store.delete("k").expect("捨てられない");

        assert!(!root.join("k.tmp").exists(), "作業中のファイルが残っている");
    }

    /// 無いこと以外の読めない理由は `NotFound` にしない。`NotFound` は「作り直せばよい」と読まれる。
    ///
    /// 本体の場所にフォルダを置くと、読むのも消すのも OS が断る。
    #[test]
    fn a_blob_that_cannot_be_read_is_not_reported_as_missing() {
        let root = tmp_root("unreadable");
        fs::create_dir_all(root.join("k.blob")).expect("フォルダを作れない");
        let store = DiskStore::new(root);

        assert!(
            matches!(store.load("k"), Err(StoreError::Io(_))),
            "読めないのに無いと答えた"
        );
        assert!(
            matches!(store.delete("k"), Err(StoreError::Io(_))),
            "消せないのに成功と答えた"
        );
    }

    /// 失敗を仕込んだ置き場は、置くと落ちる。読み手の試験はこの置き場で置けない失敗を踏む。
    #[test]
    fn a_failing_store_reports_the_failure() {
        assert!(matches!(
            InMemory::failing().save("k", b"x"),
            Err(StoreError::Io(_))
        ));
    }
}
