//! 本番コードに `.unwrap()` を残さない。
//!
//! Tauri のコマンドの中で panic すると、そのタスクが飛んで応答チャンネルが落ち、
//! **`invoke` の promise が永久に解決しない**。利用者に見えるのは
//! 「押しても何も起きない」で、ログにも何も出ない。
//!
//! `.expect("理由")` は通す。**理由を書けるなら、それは判断であって放置ではない。**
//! 書けないなら `?` か `unwrap_or_default()` にすること。
//!
//! 数えるのではなく 0 で固定してある。いま 0 なので、増やす側が説明を書く。
//!
//! **「本番に残っているのはここだけ」を人が数えない。** 数えた側は1件直して
//! 「唯一」と書けてしまい、同じ形の兄弟が別のファイルに残る。
//! 件数を言いたくなったらこの検査を走らせること。

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

/// `#[cfg(test)]` が付いた塊を落とす。
///
/// 波括弧を数えるだけ。文字列リテラルの中の括弧までは見ていないので、
/// テストの中に `"{"` だけを含む文字列があると釣り合いが崩れる。
/// **崩れると余分に落ちる＝検査が緩くなる**ので、崩れたら
/// `the_scanner_still_sees_production_code` が先に落ちる。
fn strip_test_modules(source: &str) -> String {
    let mut out = String::new();
    let mut rest = source;

    while let Some(at) = rest.find("#[cfg(test)]") {
        out.push_str(&rest[..at]);

        let Some(open) = rest[at..].find('{') else {
            break;
        };
        let open = at + open;

        let mut depth = 0usize;
        let mut end = None;
        for (offset, ch) in rest[open..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(open + offset + 1);
                        break;
                    }
                }
                _ => {}
            }
        }

        match end {
            Some(end) => rest = &rest[end..],
            // 閉じない塊。以降は全部テストとみなす
            None => return out,
        }
    }

    out.push_str(rest);
    out
}

/// 行コメントを落とす。`.unwrap()` を説明している文が違反に数えられないように
fn strip_line_comments(source: &str) -> String {
    source
        .lines()
        .map(|line| match line.find("//") {
            Some(at) => &line[..at],
            None => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn production_code(path: &Path) -> String {
    let source = fs::read_to_string(path).unwrap_or_default();
    strip_line_comments(&strip_test_modules(&source))
}

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

#[test]
fn production_code_has_no_bare_unwrap() {
    let mut offenders = Vec::new();

    for path in rust_files(&src_dir()) {
        for (number, line) in production_code(&path).lines().enumerate() {
            if line.contains(".unwrap()") {
                offenders.push(format!(
                    "{}:{}  {}",
                    path.display(),
                    number + 1,
                    line.trim()
                ));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "本番コードに `.unwrap()` がある。理由を書けるなら `.expect(\"理由\")`、\
         書けないなら `?` か `unwrap_or_default()` にすること:\n{}",
        offenders.join("\n")
    );
}

/// 走査が空振りしても違反0になる。歩けていることを別に固定する。
///
/// `strip_test_modules` が括弧を数え違えて本番コードごと落とすと、
/// 上の検査は静かに緑になる。ここが先に落ちる
#[test]
fn the_scanner_still_sees_production_code() {
    let files = rust_files(&src_dir());
    assert!(files.len() > 10, "{} ファイルしか歩けていない", files.len());

    let total: usize = files.iter().map(|p| production_code(p).len()).sum();
    assert!(total > 100_000, "本番コードが {total} 文字しか残っていない");

    // `#[cfg(test)]` の中だけにある綴りが落ちていること。
    // これが残るなら、塊を落とせていない
    let session = production_code(&src_dir().join("engine").join("game").join("session.rs"));
    assert!(
        !session.contains("fn two_humans"),
        "`#[cfg(test)]` の中を落とせていない"
    );
    assert!(
        session.contains("async fn on_tick"),
        "本番の関数まで落としている"
    );
}
