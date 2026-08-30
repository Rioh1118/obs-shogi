//! テストの一時ディレクトリ名に、プロセスを分ける要素が入っていること。
//!
//! `std::env::temp_dir()` はワークツリーをまたいで共有される。このリポジトリは
//! worktree を並べて `verify:rust` を同時に走らせる進め方なので、名前が固定だと
//! 片方の後片付け（`remove_dir_all`）がもう片方の実体を消す。
//!
//! **出るのは非決定的な赤。** 落ちたのが自分の変更のせいか判別できず、再実行で
//! 消えるため誰も原因を追わない。人の注意では、テストを1本足すたびに再発する。

use std::fs;
use std::path::{Path, PathBuf};

/// 一時ディレクトリ名に入っていればプロセスが分かれる語。
///
/// `scratch_dir` は `book` の共通の置き場で、中で `process::id()` を混ぜている。
const SEPARATORS: [&str; 2] = ["process::id()", "scratch_dir"];

fn rust_files(dir: &Path, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, found);
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn a_temp_dir_name_is_not_shared_between_processes() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rust_files(&root.join("src"), &mut files);
    rust_files(&root.join("tests"), &mut files);

    let mut offenders = Vec::new();
    let mut scanned = 0;

    for file in &files {
        // この検査自身は、止めたい形を語として書く場所
        if file.ends_with("temp_dir_names.rs") {
            continue;
        }
        let text = fs::read_to_string(file).expect("読めない");
        let lines: Vec<&str> = text.lines().collect();
        for (number, line) in lines.iter().enumerate() {
            // コメントの中の言及は見ない。この検査の理由を書けなくなる
            if !line.contains("temp_dir()") || line.trim_start().starts_with("//") {
                continue;
            }
            scanned += 1;
            // 名前は複数行に分けて組むことがある（`format!` の引数が折り返る）。
            // 続く数行までを1つの式として見る
            let block = lines[number..(number + 5).min(lines.len())].join("\n");
            if SEPARATORS.iter().any(|s| block.contains(s)) {
                continue;
            }
            offenders.push(format!(
                "{}:{}  {}",
                file.strip_prefix(root).unwrap_or(file).display(),
                number + 1,
                line.trim()
            ));
        }
    }

    // 走査が空振りしても「違反0」になる。実際に見ていることを別に固定する
    assert!(scanned >= 5, "temp_dir() の行を {scanned} 本しか見ていない");

    assert!(
        offenders.is_empty(),
        "一時ディレクトリ名がプロセス間で共有されている:\n{}\n\
         `std::process::id()` を混ぜるか、`book` の `scratch_dir` を使うこと。",
        offenders.join("\n")
    );
}
