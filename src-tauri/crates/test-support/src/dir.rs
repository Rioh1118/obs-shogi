//! テストが使う道具。棋譜の中身に依らないもの。
//!
//! 棋譜そのものの材料は `search/test_kifu.rs`。

use std::path::PathBuf;

/// テストごとに分かれた空の一時ディレクトリを作る。
///
/// 中身を消してから作り直す。前回の実行が assert で落ちて後始末に届かなかった場合、
/// 残骸が次の実行に混ざる。
///
/// `tag` はテストごとに違うものにすること。プロセス番号とスレッド番号も入れるが、
/// **同じスレッドで走る2つのテストは `tag` でしか分かれない**。
pub fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "obs-shogi-{tag}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("一時ディレクトリ");
    dir
}
