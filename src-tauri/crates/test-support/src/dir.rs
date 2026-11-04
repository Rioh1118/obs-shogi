//! テストが使う道具。棋譜の中身に依らないもの。
//!
//! 棋譜そのものの材料は同じ crate の `kifu.rs`。

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// テストごとに分かれた空の一時ディレクトリを作る。
///
/// 中身を消してから作り直す。名前はプロセス番号を含むので、前回の実行と重なるのは
/// 番号が使い回されたときだけ。そのときに、assert で落ちて後始末に届かなかった残骸を混ぜない。
///
/// **`std::env::temp_dir()` はワークツリーをまたいで共有される。**
/// このリポジトリは worktree を並べて `verify:rust` を同時に走らせるので、
/// 名前が固定だと片方の後片付けがもう片方の実体を消す。落ちたのが自分の変更のせいか
/// 判別できない赤が出て、再実行で消えるため誰も原因を追わない。
/// プロセス番号・スレッド番号に加えて連番も混ぜるので、
/// 同じ `tag` を2度使っても分かれる。
pub fn temp_dir(tag: &str) -> PathBuf {
    let serial = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "obs-shogi-{tag}-{}-{:?}-{serial}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("一時ディレクトリ");
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 同じ `tag` を2度使っても、片方の後始末がもう片方を消さない
    #[test]
    fn the_same_tag_twice_gives_two_empty_directories() {
        let first = temp_dir("twice");
        std::fs::write(first.join("a"), "").unwrap();
        let second = temp_dir("twice");

        assert_ne!(first, second);
        assert!(first.join("a").exists(), "先に作った方が消された");
        assert_eq!(std::fs::read_dir(&second).unwrap().count(), 0);

        let _ = std::fs::remove_dir_all(&first);
        let _ = std::fs::remove_dir_all(&second);
    }
}
