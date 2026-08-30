//! テストが使う一時ディレクトリの置き場。
//!
//! **固定名を使わない。** `std::env::temp_dir()` はワークツリーをまたいで
//! 共有される。このリポジトリは worktree を並べて `verify:rust` を同時に走らせる
//! 進め方なので、名前が固定だと片方の後片付け（`remove_dir_all`）が
//! もう片方の実体を消す。落ちたのが自分の変更のせいか判別できない赤が出て、
//! 再実行で消えるため誰も原因を追わない。
//!
//! プロセス ID と連番を混ぜる。同一プロセス内で名前が衝突しないよう連番も要る
//! （同じ `name` を2度使うテストが将来出る）。

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// このプロセスだけが使う一時ディレクトリ。作るところまでやる。
///
/// 後片付けは呼び手が `let _ = std::fs::remove_dir_all(&dir);` で捨てること。
/// **`expect` にしない。** 後片付けの失敗はテストの主張ではないし、
/// そこで panic すると本体の assert より先に落ちて原因が隠れる。
pub(crate) fn scratch_dir(name: &str) -> PathBuf {
    let serial = NEXT.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!(
        "obs-shogi-book-{name}-{}-{serial}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("テスト用のディレクトリを作れない");
    dir
}
