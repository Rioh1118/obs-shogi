//! 状態遷移表が、実在しない定数を仕様として書いていないことを見る。
//!
//! **表は仕様として読まれる。** `docs/state-transitions/yaneuraou-db-parse.md` は
//! 冒頭で「仕様の突き合わせのために置く」と宣言していて、実装より表を信じる
//! 読み方を前提にしている。そこに消した定数が残っていると、次に触る人は
//! 存在しない検査を前提に設計する。
//!
//! 見るのは大文字の定数名だけ。表には `book.cpp:709-716` のような外部の出典も
//! 関数名も出るので、それらまで実在を要求すると表が書けなくなる。定数は
//! 綴りが一意で、腐ったときに読み手が最も強く誤解する。
//!
//! ✓ の正しさ（そのセルを踏むテストが本当にあるか）はここでは見られない。
//! 表の全セルにテスト名を書く規約が要るので、それは別の話。

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// 表と、その表が指している実装。
const TABLES: [(&str, &[&str]); 1] = [(
    "docs/state-transitions/yaneuraou-db-parse.md",
    &["src/book/yaneuraou_db.rs", "src/book/sfen.rs"],
)];

/// 表に出るが実装の識別子ではないもの。
///
/// **理由なしで足さない。** ここへ足すたびに検査の目が粗くなる。
const NOT_IDENTIFIERS: [&str; 2] = [
    // やねうら王の定跡フォーマットの見出し。文字列であって定数名ではない
    "YANEURAOU",
    // 局面数の注記。`# NOE:` の綴りの一部
    "NOE",
];

fn repo_file(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

/// バッククォートで囲まれた大文字の定数名を集める。
fn constants_in(text: &str) -> BTreeSet<String> {
    let mut found = BTreeSet::new();
    // バッククォートの中は式のこともある（`a * B + c > D`）ので、語ごとに切る。
    for chunk in text.split('`').skip(1).step_by(2) {
        for word in chunk.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')) {
            let is_constant = word.len() >= 3
                && word
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
                && word.chars().any(|c| c.is_ascii_uppercase());
            if is_constant && !NOT_IDENTIFIERS.contains(&word) {
                found.insert(word.to_string());
            }
        }
    }
    found
}

#[test]
fn every_constant_named_in_a_table_exists_in_the_source() {
    for (table, sources) in TABLES {
        let text = fs::read_to_string(repo_file(table)).expect("表を読めない");
        let code: String = sources
            .iter()
            .map(|s| {
                fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(s))
                    .expect("実装を読めない")
            })
            .collect();

        let missing: Vec<String> = constants_in(&text)
            .into_iter()
            .filter(|name| !code.contains(name.as_str()))
            .collect();

        assert!(
            missing.is_empty(),
            "{table} が実装に無い定数を書いている: {missing:?}\n\
             消した定数なら表も直すこと。表は仕様として読まれるので、\n\
             存在しない検査を前提に設計する人が出る。",
        );
    }
}

/// 検査そのものが空振りしていないこと。
///
/// 表から定数を1つも拾えていなければ、上のテストは何を消しても通る。
#[test]
fn the_check_actually_finds_constants() {
    let text = fs::read_to_string(repo_file(TABLES[0].0)).expect("表を読めない");
    let found = constants_in(&text);

    assert!(
        found.len() >= 5,
        "表から拾えた定数が少なすぎる（{}件）。綴りの規則が変わったかもしれない: {found:?}",
        found.len()
    );
}
