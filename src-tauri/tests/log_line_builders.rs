//! ログの行が予算を超えないことを見るテストが、**本番が組む行**を測っていること。
//!
//! **防壁を足した回に、その防壁を守らないテストが一緒に入る形を止める。**
//! `shown` を直に呼ぶテストは、`shown` の性質しか確かめない —— 入口の潰しを
//! 丸ごと外しても緑のまま通り、**守るはずの不変条件を1つも固定しない**。
//!
//! 正しい形は `engine::registry` と `engine::game::session` が持っている ——
//! 行を組む関数（`spawn_ok_line` / `over_line`）を切り、テストは**その関数の出力**を測る。
//! そうすると、潰す処理が本番から消えた瞬間に赤くなる。
//!
//! **`shown` を呼ぶこと自体は禁じない。** 「渡した値が本当に最悪か」を確かめる
//! 前提の表明には要る（`registry` も `session` もそうしている）。見るのは
//! **行を組む関数を1つも通っていないか**だけ。

mod roots;
mod scanning;

use scanning::strip_test_modules;

use std::fs;
use std::path::{Path, PathBuf};

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

/// テストモジュールの中身だけ。`strip_test_modules` の裏返しを、
/// 本文から本番のぶんを引いて取る。
fn test_code(path: &Path) -> String {
    let whole = fs::read_to_string(path).unwrap_or_default();
    let production = strip_test_modules(&whole, path);

    whole
        .lines()
        .filter(|line| !production.contains(*line))
        .collect::<Vec<_>>()
        .join("\n")
}

/// このテストが呼んでいる、行を組む関数（`..._line(`）。
fn calls_a_line_builder(body: &str) -> bool {
    body.match_indices("_line(").any(|(at, _)| {
        body[..at]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
    })
}

/// 予算を見るテストの本体を、名前ごとに取り出す。
fn budget_tests(code: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();

    for (at, _) in code.match_indices("fn ") {
        let after = &code[at + 3..];
        let Some(paren) = after.find('(') else { continue };
        let name = &after[..paren];
        if !name.contains("rotate_the_log") {
            continue;
        }
        let body = &after[paren..];
        let end = body.find("\n    }").map(|e| e + 6).unwrap_or(body.len());
        found.push((name.to_string(), body[..end].to_string()));
    }
    found
}

#[test]
fn budget_tests_measure_the_line_production_builds() {
    let sources: Vec<PathBuf> = roots::production_roots()
        .iter()
        .flat_map(|r| rust_files(r))
        .collect();

    let all: Vec<(String, String, String)> = sources
        .iter()
        .flat_map(|p| {
            budget_tests(&test_code(p))
                .into_iter()
                .map(move |(name, body)| (p.display().to_string(), name, body))
        })
        .collect();

    // 0件を見て緑になる形を止める
    assert!(
        all.len() >= 3,
        "予算を見るテストを拾えていない（{} 件）",
        all.len()
    );

    let offenders: Vec<String> = all
        .iter()
        .filter(|(_, _, body)| !calls_a_line_builder(body))
        .map(|(path, name, _)| format!("{path}: {name}"))
        .collect();

    assert!(
        offenders.is_empty(),
        "予算を見るテストが、本番の行を組む関数を1つも通っていない。\n\
         `shown` を直に呼ぶだけだと、入口の潰しを外す変異が素通りする:\n{}",
        offenders.join("\n")
    );
}
