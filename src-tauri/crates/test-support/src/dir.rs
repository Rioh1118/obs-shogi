//! テストが使う道具。棋譜の中身に依らないもの。
//!
//! 棋譜そのものの材料は `search/test_kifu.rs`。

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// テストごとに分かれた空の一時ディレクトリを作る。
///
/// 中身を消してから作り直す。前回の実行が assert で落ちて後始末に届かなかった場合、
/// 残骸が次の実行に混ざる。
///
/// **`std::env::temp_dir()` はワークツリーをまたいで共有される。**
/// このリポジトリは worktree を並べて `verify:rust` を同時に走らせるので、
/// 名前が固定だと片方の後片付けがもう片方の実体を消す。落ちたのが自分の変更のせいか
/// 判別できない赤が出て、再実行で消えるため誰も原因を追わない。
/// プロセス番号・スレッド番号に加えて連番も混ぜるので、
/// **同じ `tag` を2度使っても分かれる。**
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
