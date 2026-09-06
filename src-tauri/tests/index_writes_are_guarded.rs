//! 索引に書く経路が、**代（epoch）の門番を通っているか。**
//!
//! 2回目の `open` が来ても、走っている全件構築や差分適用は止まらない。
//! そのとき索引は別のものへ差し替わっているので、代を見ずに書くと
//! **前のプロジェクトの `file_id` を別の索引へ積む**。
//! `search/build.rs` の doc がその壊れ方を書いている。
//!
//! **`IndexStore::update` は代を見ない。** 索引を持っているのが自分だと
//! 分かっている呼び手だけが使ってよく、走っているタスクからは
//! `update_if_epoch` / `snapshot_if_epoch` を通す。
//!
//! ここが見るのは綴りだけ。**「代を持ち回っているか」までは見ない** ——
//! それは人が読む。

use std::fs;
use std::path::{Path, PathBuf};

mod scanning;
use scanning::blank_out_noncode;

/// `store` を持ち回るタスクの側。**ここに素の `update` があってはいけない。**
const TASKS: [&str; 3] = [
    "src/search/build.rs",
    "src/search/project_manager.rs",
    "src/search/commands.rs",
];

fn read_code(rel: &str) -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    let s = fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()));
    blank_out_noncode(&s)
}

/// **走っているタスクが、代を見ない `update` を呼んでいないこと。**
#[test]
fn no_running_task_writes_without_checking_the_epoch() {
    let offenders: Vec<String> = TASKS
        .iter()
        .filter(|rel| {
            let code = read_code(rel);
            code.contains(".update(|") || code.contains("store.update(")
        })
        .map(|rel| (*rel).to_owned())
        .collect();

    assert!(
        offenders.is_empty(),
        "代を見ない `update` がタスクの中にある。`update_if_epoch` を通すこと:\n{}",
        offenders.join("\n")
    );
}

/// **代を配る口が、代を返していること。**
///
/// 返さずに `snapshot().epoch` で拾わせると、`restart` から拾うまでの間に
/// 別の `open` が入ったとき**他人の代を掴む**。
#[test]
fn the_store_hands_back_the_epoch_it_installed() {
    let code = read_code("src/search/store/index_store.rs");

    for sig in [
        "pub fn restart(&self, at: Restart) -> u64",
        "    ) -> u64 {",
    ] {
        assert!(
            code.contains(sig),
            "代を配る口が代を返していない（`{sig}` が無い）"
        );
    }
}

/// **`build_full_index_task` が代を呼び手から受けていること。**
///
/// 引数を1つずつ並べるか、まとめた構造体（`FullBuild`）で渡すかは問わない
/// ——見るのは「中で `snapshot().epoch` を拾っていないこと」。
/// 拾うと `restart` から拾うまでの間に別の `open` が入ったとき**他人の代を掴む**。
#[test]
fn the_full_build_takes_the_epoch_from_its_caller() {
    let code = read_code("src/search/build.rs");
    let head = code
        .split_once("pub async fn build_full_index_task(")
        .and_then(|(_, t)| t.split_once(')').map(|(h, _)| h.to_owned()))
        .expect("build_full_index_task が無い");

    // 引数に代そのものが並ぶか、それを持つ形が並ぶか
    assert!(
        head.contains("epoch: u64") || head.contains("FullBuild"),
        "代を呼び手から受けていない:\n{head}"
    );
    assert!(
        code.contains("pub epoch: u64") || head.contains("epoch: u64"),
        "受けている形の中に代が無い"
    );
    // **中で拾わないこと。** ここが本体
    assert!(
        !code.contains("snapshot().epoch"),
        "全件構築が代を自分で拾っている。`restart` から拾うまでの間に\
         別の `open` が入ると他人の代を掴む"
    );
}

/// 走査の根が実在すること。**綴りが動いたら気付く。**
#[test]
fn every_task_file_exists() {
    for rel in TASKS {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
        assert!(
            Path::new(&p).exists(),
            "{} が無い。移したらこの一覧も直すこと",
            p.display()
        );
    }
}
