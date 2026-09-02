//! `tokio::time::timeout` の**内側の `Result` を捨てない**。
//!
//! 戻りは `Result<Result<T, E>, Elapsed>` の二重。`.is_ok()` / `.is_err()` は
//! 外側しか見ないので、内側の `Err` が「成功した」に化ける。
//!
//! 化けると、**失敗が別の失敗として説明される**。`stop` の書き込みが断られたのに
//! 「エンジンが `stop` に応じなかった」という説明が棋譜と画面に残る、という形で出た。
//!
//! 分けたいなら `match` で3分岐にすること。潰してよいと判断したなら、
//! `let _ = ...` ではなく理由をコメントに書いたうえで `matches!` を使う。

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

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// `timeout(` から数えて、この行数のうちに `.is_ok()` / `.is_err()` が来たら
/// 同じ式だとみなす。
///
/// 式を跨いで数えるので、無関係な `.is_ok()` を巻き込むことがある。
/// **巻き込む側に倒してある**。見逃すより、書いた人に一度読ませるほうがよい。
const WINDOW: usize = 6;

/// 上限を超えたか**だけ**を見たい呼び出し。中身が `()` なので捨てる `Result` が無い。
///
/// 増やすときは、その `timeout` の内側が `Result` を返さないことを確かめること。
/// 位置は `src` からの相対パスと行番号。行がずれたら赤くなるので、
/// **動かしたときに必ず読み直すことになる**（それが狙い）。
const EXEMPT: &[&str] = &[
    // `UsiProtocol::kill_engine` は戻り値を持たない
    "engine/registry.rs:198",
];

#[test]
fn a_timeout_never_swallows_the_inner_result() {
    let mut offenders = Vec::new();

    for path in rust_files(&src_dir()) {
        let source = fs::read_to_string(&path).unwrap_or_default();
        let lines: Vec<&str> = source.lines().collect();

        for (index, line) in lines.iter().enumerate() {
            if !line.contains("timeout(") {
                continue;
            }
            let relative = path.strip_prefix(src_dir()).unwrap_or(&path);
            let here = format!("{}:{}", relative.display(), index + 1);
            if EXEMPT.contains(&here.as_str()) {
                continue;
            }

            let end = (index + WINDOW).min(lines.len());
            let window = lines[index..end].join("\n");
            if window.contains(".is_ok()") || window.contains(".is_err()") {
                offenders.push(format!("{}  {}", here, line.trim()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "`timeout` の戻りを `.is_ok()` / `.is_err()` で見ている。\
         内側の `Result` が捨てられ、失敗が「成功」に化ける。\
         `match` で3分岐にすること:\n{}",
        offenders.join("\n")
    );
}

/// 走査が空振りしても違反0になる。`timeout` を実際に拾えていることを固定する
#[test]
fn the_scanner_finds_the_timeouts() {
    let hits: usize = rust_files(&src_dir())
        .iter()
        .map(|p| {
            fs::read_to_string(p)
                .unwrap_or_default()
                .matches("timeout(")
                .count()
        })
        .sum();

    assert!(hits > 3, "`timeout(` を {hits} 件しか拾えていない");
}
