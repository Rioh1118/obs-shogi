//! Rust のコメントに**変更の経緯**を書かない。
//!
//! `src/__tests__/commentHistory.test.ts` の Rust 版。あちらは `src/**` の TS を見る。
//! 同じ規約（`CONTRIBUTING.md` の「変更の経緯を書かない」）が Rust にも掛かるのに、
//! 見ている検査が片側だけだった。
//!
//! 読み手はその変更を書いた人ではない。「元は何だったか」「どのレビューで出たか」は
//! マージした時点で指すものが消え、残るのは辿れない参照だけになる。
//!
//! **このファイル自身も走査の対象。** 止めたい形は下の `HISTORY_WORDS` に
//! **リテラルとして**書くこと。文章で例示すると自分で落ちる。

use std::fs;
use std::path::{Path, PathBuf};

/// 経緯にしか出てこない語。**「なぜ」を書くのに要らないものだけ**を並べる。
///
/// 増やすときは、これ無しでは書けない「なぜ」が本当に無いかを確かめること。
/// **現物で試してから足す。** 誤検出が出る語は、当たった側を言い換えで
/// 消せるなら消してから足し、消せないなら足さない。
///
/// ここに語を例として書かないこと。書くと自分で落ちる。
const HISTORY_WORDS: &[&str] = &[
    "ようになった",
    "ようにした",
    "今回",
    "PR #",
    "この PR",
    "で対応",
    "この差分",
    "同じ差分",
    "に変更した",
    "から変えた",
    "残っていた",
    "旧来",
    "旧実装",
    "旧仕様",
    "以前",
    "かつて",
    "元々",
    "時期があ",
];

fn rust_files(dir: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(rust_files(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
    found.sort();
    found
}

/// 見るのは `src` と `tests` の両方。
///
/// `tests` を外すと、**検査の doc に経緯が溜まっても誰も止められない**。
/// TS 側で自己免除を外したのと同じ理由。
fn roots() -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    vec![manifest.join("src"), manifest.join("tests")]
}

#[test]
fn comments_do_not_carry_change_history() {
    let mut offenders = Vec::new();
    let mut scanned = 0usize;

    for root in roots() {
        for path in rust_files(&root) {
            scanned += 1;
            let source = fs::read_to_string(&path).unwrap_or_default();
            let relative = path.strip_prefix(&root).unwrap_or(&path).to_path_buf();

            for (index, line) in source.lines().enumerate() {
                let trimmed = line.trim_start();
                if !trimmed.starts_with("//") {
                    continue;
                }
                if let Some(word) = HISTORY_WORDS.iter().find(|w| trimmed.contains(**w)) {
                    offenders.push(format!(
                        "{}:{}  「{}」  {}",
                        relative.display(),
                        index + 1,
                        word,
                        trimmed.chars().take(60).collect::<String>()
                    ));
                }
            }
        }
    }

    // 走査が空振りしても「違反0」になる。歩けていることを別に固定する
    assert!(scanned > 15, "{scanned} ファイルしか歩けていない");

    assert!(
        offenders.is_empty(),
        "コメントに変更の経緯が入っている。\
         読み手はその変更を書いた人ではない。いま何がどうあるべきかだけを書くこと:\n{}",
        offenders.join("\n")
    );
}
