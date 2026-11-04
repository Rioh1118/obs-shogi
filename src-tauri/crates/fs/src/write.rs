//! 途中で壊れない書き込み。

use std::fs;
use std::io::Write;
use std::path::Path;

/// `path` の中身を `data` に置き換える。書いている途中でプロセスが落ちても、
/// `path` に書きかけの中身は残らない。
///
/// 隣の一時ファイル（`a.kif` なら `a.kif.tmp`）に書いてから rename する。
/// 親のフォルダが無ければ作る。rename に失敗したら一時ファイルを消して、その失敗を返す。
pub fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let tmp = match path.extension() {
        Some(ext) => {
            let mut new_ext = ext.to_os_string();
            new_ext.push(".tmp");
            path.with_extension(new_ext)
        }
        None => path.with_extension("tmp"),
    };
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&tmp)?;
        f.write_all(data)?;
        f.flush()?;
    }
    match fs::rename(&tmp, path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("obs-shogi-write-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("作れない");
        dir
    }

    /// 書いた後に一時ファイルを残さない。残ると、ツリーに `.tmp` の行が増える
    #[test]
    fn replaces_the_contents_and_leaves_no_temporary_file() {
        let dir = temp_dir("replace");
        let path = dir.join("nested").join("a.kif");

        atomic_write(&path, b"first").expect("書けない");
        atomic_write(&path, b"second").expect("書けない");

        assert_eq!(fs::read(&path).unwrap(), b"second");
        assert!(!dir.join("nested").join("a.kif.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    /// 前の実行が残した長い一時ファイルの続きを、新しい中身に混ぜない
    #[test]
    fn a_leftover_temporary_file_does_not_leak_into_the_result() {
        let dir = temp_dir("leftover");
        let path = dir.join("a.kif");
        fs::write(dir.join("a.kif.tmp"), b"a much longer leftover").unwrap();

        atomic_write(&path, b"short").expect("書けない");

        assert_eq!(fs::read(&path).unwrap(), b"short");
        let _ = fs::remove_dir_all(&dir);
    }

    /// 一時ファイルを作れなければ失敗し、元の中身には触らない
    #[test]
    fn the_original_is_untouched_when_the_temporary_file_cannot_be_made() {
        let dir = temp_dir("blocked");
        for (name, tmp) in [("a.kif", "a.kif.tmp"), ("a", "a.tmp")] {
            let path = dir.join(name);
            fs::write(&path, b"original").unwrap();
            fs::create_dir_all(dir.join(tmp)).unwrap();

            assert!(
                atomic_write(&path, b"new").is_err(),
                "{name} に書けてしまった"
            );
            assert_eq!(fs::read(&path).unwrap(), b"original");
        }
        let _ = fs::remove_dir_all(&dir);
    }

    /// rename が断られたら、一時ファイルを消してから失敗を返す
    #[cfg(unix)]
    #[test]
    fn a_failed_rename_cleans_up_the_temporary_file() {
        let dir = temp_dir("rename");
        let path = dir.join("taken");
        fs::create_dir_all(path.join("child")).unwrap();

        assert!(atomic_write(&path, b"data").is_err());
        assert!(!dir.join("taken.tmp").exists(), "一時ファイルが残った");
        let _ = fs::remove_dir_all(&dir);
    }
}
