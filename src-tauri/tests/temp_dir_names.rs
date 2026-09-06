//! テストの一時ディレクトリ名に、プロセスを分ける要素が入っていること。
//!
//! `std::env::temp_dir()` はワークツリーをまたいで共有される。このリポジトリは
//! worktree を並べて `verify:rust` を同時に走らせる進め方なので、名前が固定だと
//! 片方の後片付け（`remove_dir_all`）がもう片方の実体を消す。
//!
//! **出るのは非決定的な赤。** 落ちたのが自分の変更のせいか判別できず、再実行で
//! 消えるため誰も原因を追わない。人の注意では、テストを1本足すたびに再発する。

mod scanning;
use scanning::blank_out_comments;

use std::fs;
use std::path::{Path, PathBuf};

/// 一時ディレクトリ名に入っていればプロセスが分かれる語。
///
/// `test_support` の `temp_dir` は共通の置き場で、中で `process::id()` と
/// スレッド番号と連番を混ぜている。**crate 全体から引ける**ので、
/// 下の案内はどのモジュールでも実行できる。
///
/// **引き金と綴りが重なるものを入れないこと（どちら向きでも）。**
/// 走査は `std::env::temp_dir()` を含む行を拾うので、そこに一致する綴りを
/// separator にすると、**その行自身が条件を満たして offender が原理的に0になる。**
/// 検査は緑のまま何も見なくなる。下の `a_known_offender_is_still_caught` が見る。
const SEPARATORS: [&str; 2] = ["process::id()", "test_support::temp_dir("];

/// 走査の引き金。この綴りを含む行だけを見る
const TRIGGER: &str = "temp_dir()";

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
        let raw = fs::read_to_string(file).expect("読めない");
        // コメントの中の言及は見ない。この検査の理由を書けなくなる。
        // **手で `//` を探さない。** 文字列の中の `//` をコメントの始まりと
        // 読むと、その行が丸ごと死角に入る（`scanning` はそこを潰す）。
        let text = blank_out_comments(&raw);
        let lines: Vec<&str> = text.lines().collect();
        for (number, line) in lines.iter().enumerate() {
            if !line.contains(TRIGGER) {
                continue;
            }
            scanned += 1;
            // 名前は複数行に分けて組むことがある（`format!` の引数が折り返る）。
            // 続く数行までを1つの式として見る
            let block = lines[number..(number + 5).min(lines.len())].join("\n");
            if !offends(&block) {
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
         `std::process::id()` を混ぜるか、`test_support` の `temp_dir` を使うこと。",
        offenders.join("\n")
    );
}

/// **既知の違反を、判定が実際に offender と読むこと。**
///
/// separator が引き金と一致すると、走査した行が必ず自分で条件を満たし、
/// offender が0になる。**包含はどちら向きでも起きる** ——
/// 引き金より長い綴りを separator にしても同じ状態になるので、
/// 綴りの比較ではなく**判定そのものに既知の入力を食わせる。**
/// 空振り止め（`scanned`）は行を数えているだけで、この壊れ方を見ていない。
#[test]
fn a_known_offender_is_still_caught() {
    let bad = "    let dir = std::env::temp_dir().join(\"obs-shogi-fixed\");";
    let good = "    let dir = std::env::temp_dir().join(format!(\"x-{}\", std::process::id()));";

    assert!(
        offends(bad),
        "固定名を offender と読めていない。separator が引き金と重なっていないか"
    );
    assert!(!offends(good), "正当な綴りを offender と読んでいる");
}

/// 走査の判定そのもの。**テストと本体で同じものを通す。**
fn offends(block: &str) -> bool {
    block.contains(TRIGGER) && !SEPARATORS.iter().any(|s| block.contains(s))
}
