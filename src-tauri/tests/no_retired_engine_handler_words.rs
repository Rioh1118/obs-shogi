//! 手放したエンジンの持ち方を前提にした綴りを、コードと文書に残さない。
//!
//! エンジンの子プロセスは `engine/child.rs` が持つ。手放した持ち方（`usi` crate の
//! ハンドラ）の綴りは、**消えた仕組みを理由に使う文**としてしか残りえない——
//! 例えば「kill は `quit` の書き込みで折り返すとシグナルを送らない」は今の実装では起きない。
//! そういう文を信じた読み手は、今の実装に無い穴を塞ぎに行くか、今ある穴を見落とす。
//!
//! **人の注意では止まらない形。** 書き換えのとき、触ったファイルの doc は直せても、
//! 触っていないファイル（仕様書、状態遷移表、貢献の手引き）が同じ前提で書かれていることに
//! 気付けない。綴りで止める。
//!
//! 見るのは識別子の綴りだけで、文の中身が今の実装と合っているかは見ない。

mod roots;

use std::fs;
use std::path::{Path, PathBuf};

/// 手放した仕組みの綴り。**足すときは、その仕組みを手放したときに。**
const RETIRED: [&str; 5] = [
    "UsiEngineHandler",
    "handler.kill()",
    "classify_kill_failure",
    "output_ended",
    "kill().unwrap()",
];

/// このファイル自身は綴りを持つので見ない
const SELF_NAME: &str = "no_retired_engine_handler_words.rs";

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri の親がリポジトリの根")
        .to_path_buf()
}

fn files_with(dir: &Path, extension: &str, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            files_with(&path, extension, found);
        } else if path.extension().is_some_and(|e| e == extension) {
            found.push(path);
        }
    }
}

/// 見る範囲: Rust のソースとテスト、`docs/` の文書、根の手引き
fn sources() -> Vec<PathBuf> {
    let root = repo_root();
    let mut found = Vec::new();
    for dir in roots::production_roots() {
        files_with(&dir, "rs", &mut found);
    }
    files_with(&root.join("src-tauri/tests"), "rs", &mut found);
    files_with(&root.join("docs"), "md", &mut found);
    for name in ["CONTRIBUTING.md", "CLAUDE.md", "README.md"] {
        let path = root.join(name);
        if path.exists() {
            found.push(path);
        }
    }
    found.retain(|path| !matches!(path.file_name(), Some(name) if name == SELF_NAME));
    found.sort();
    found.dedup();
    found
}

#[test]
fn retired_engine_handler_words_do_not_come_back() {
    let files = sources();
    // 走査が空振りしても違反0になる。**見た数の下限を置く**
    assert!(
        files.len() >= 200,
        "見たファイルが {} 件しかない。走査の根が変わったなら `sources` を直すこと",
        files.len()
    );

    let root = repo_root();
    let mut offenders = Vec::new();
    for path in &files {
        let text = fs::read_to_string(path).unwrap_or_default();
        for (number, line) in text.lines().enumerate() {
            for word in RETIRED {
                if line.contains(word) {
                    offenders.push(format!(
                        "{}:{}  `{word}`",
                        path.strip_prefix(&root).unwrap_or(path).display(),
                        number + 1
                    ));
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "手放したエンジンの持ち方の綴りが残っている。今の仕組み（`engine/child.rs`）で\n\
         書き直すこと:\n{}",
        offenders.join("\n")
    );
}

/// 述語に当たる形を、文字列を直に食わせて確かめる。現物で違反0だけを見ると、
/// 綴りの表が壊れても緑になる
#[test]
fn the_retired_words_are_what_the_old_docs_used() {
    let old_line = "`usi` の `UsiEngineHandler::kill` はシグナルの前に `quit` を書く";
    assert!(RETIRED.iter().any(|word| old_line.contains(word)));
    let current_line = "`EngineChild::kill_and_wait` はプロセスグループへシグナルを送る";
    assert!(!RETIRED.iter().any(|word| current_line.contains(word)));
}
