//! エンジンを落とした結果を捨てない。
//!
//! `EngineChild::kill_and_wait` は、落とせたか・上限内に終わらなかったか（**残っている**）
//! を返す（`KillOutcome`）。戻り値を `let _ =` で捨てると、残ったことを知る手掛かりが
//! 1本も無くなる——落とし手はどの経路も1回きりで、`SPAWN_TIMEOUT` を超えた子に至っては
//! どの台帳にも居ない（`registry.rs` の `starting` の doc、#381）。
//!
//! **捨てた側は緑のまま**（`#[must_use]` は `let _ =` も `let _x =` も `drop(..)` も止めない）。
//! 数えるのではなく 0 で固定して、増やす側に説明を書かせる。
//!
//! 通すのは、**結果を読む**形だけ（`match` / `if let` / `?` / 束縛）。
//! 記録しない判断をしたいなら、その理由をコメントではなくログに書くこと。
//!
//! **行ではなく文で見る。** rustfmt は長い受け手の鎖を折り返すので、
//! `kill_and_wait(` の行に `let _ =` が載っているとは限らない。

mod roots;
mod scanning;

use scanning::{production_code_of, skip_literal_or_comment};

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

fn production_code(path: &Path) -> String {
    production_code_of(&fs::read_to_string(path).unwrap_or_default(), path)
}

fn sources() -> Vec<PathBuf> {
    roots::production_roots()
        .iter()
        .flat_map(|r| rust_files(r))
        .collect()
}

/// `EngineChild::kill_and_wait` の呼び口。
///
/// **`start_kill()` は対象外**——待ち手のタスクの中の OS への頼みで、
/// 結果はそこでログに残している。
const KILL_CALL: &str = "kill_and_wait(";

/// `kill_and_wait(` の呼び口ごとに、`(行番号, その文の頭から呼び口の手前まで)` を返す。
///
/// 文の頭は直前の `;` / `{` / `}` の後ろ。**文字列・文字・コメントの中の区切りは数えない**
/// （`skip_literal_or_comment`）——`f("{", child.kill_and_wait(..))` の `{` で頭を切ると、
/// `let _ =` が見えなくなる。返す頭は空白を1つに畳む。
fn kill_call_heads(code: &str) -> Vec<(usize, String)> {
    let mut heads = Vec::new();
    let mut start = 0;
    let mut at = 0;
    while at < code.len() {
        let rest = &code[at..];
        if let Some(len) = skip_literal_or_comment(rest) {
            at += len;
            continue;
        }
        if rest.starts_with(KILL_CALL) {
            let head = code[start..at].split_whitespace().collect::<Vec<_>>();
            heads.push((code[..at].matches('\n').count() + 1, head.join(" ")));
            at += KILL_CALL.len();
            continue;
        }
        let ch = rest.chars().next().expect("残りがあれば1文字は取れる");
        if matches!(ch, ';' | '{' | '}') {
            start = at + ch.len_utf8();
        }
        at += ch.len_utf8();
    }
    heads
}

/// 文の頭が、戻り値を捨てる形か。
///
/// - `let _ =` と `let _x =`。下線で始まる束縛は、読まなくても警告が出ない
/// - `drop(..)` に渡す（`std::mem::drop(..)` も）
fn discards_result(head: &str) -> bool {
    let words: Vec<&str> = head.split_whitespace().collect();
    let binds_to_underscore = words
        .windows(2)
        .any(|pair| pair[0] == "let" && pair[1].starts_with('_'));
    let passes_to_drop = head.match_indices("drop(").any(|(at, _)| {
        !head[..at]
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
    });
    binds_to_underscore || passes_to_drop
}

#[test]
fn a_failed_kill_is_never_discarded() {
    let mut offenders = Vec::new();

    for path in sources() {
        for (line, head) in kill_call_heads(&production_code(&path)) {
            if discards_result(&head) {
                offenders.push(format!("{}:{line}  {head}{KILL_CALL}", path.display()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "`kill` の戻り値を捨てている。失敗した回はプロセスが残るので、\
         `Err` を1行残すこと:\n{}",
        offenders.join("\n")
    );
}

/// 走査が空振りしても違反0になる。**呼び口を見えていること**を別に固定する。
///
/// 綴りが変わった（`kill` を包む関数ができた、`handler` という名前をやめた）
/// だけで上の検査は静かに緑になる。ここが先に落ちる。
#[test]
fn the_scanner_still_sees_the_kill_call_sites() {
    let calls: Vec<String> = sources()
        .iter()
        .flat_map(|path| {
            kill_call_heads(&production_code(path))
                .into_iter()
                .map(|(line, head)| format!("{}:{line}  {head}", path.display()))
                .collect::<Vec<_>>()
        })
        .collect();

    assert!(
        calls.len() >= 2,
        "`kill_and_wait` の呼び口を {} 件しか見つけられていない。\
         綴りが変わったなら `KILL_CALL` を直すこと",
        calls.len()
    );
}

/// 文の頭を取って、捨てる形かを見る。**文字列を直に食わせる。**
fn discarded(code: &str) -> Vec<bool> {
    kill_call_heads(code)
        .into_iter()
        .map(|(_, head)| discards_result(&head))
        .collect()
}

/// 述語そのものを、文字列を直に食わせて確かめる。
///
/// **現物を食わせて違反0、では述語が壊れても緑になる。**
#[test]
fn the_predicates_split_reading_from_discarding() {
    // 捨てる形。rustfmt が受け手の鎖を折り返した形も
    for code in [
        "        let _ = self.child.kill_and_wait(KILL_TIMEOUT).await;",
        "        let _ = self\n            .child\n            .kill_and_wait(KILL_TIMEOUT)\n            .await;",
        "        let _outcome = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        let _: KillOutcome = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        drop(child.kill_and_wait(KILL_TIMEOUT).await);",
        "        std::mem::drop(child.kill_and_wait(KILL_TIMEOUT).await);",
        // 文字列の中の区切りで文の頭を切らない
        "        let _ = log_after(\"{;}\", child.kill_and_wait(KILL_TIMEOUT).await);",
    ] {
        assert_eq!(discarded(code), [true], "捨てる形を見逃している: {code}");
    }

    // 読む形。直前の文の `let _ =` を引きずらない
    for code in [
        "        let outcome = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        match self.child.kill_and_wait(KILL_TIMEOUT).await {",
        "        let _ = before();\n        match child.kill_and_wait(KILL_TIMEOUT).await {",
        "        let dropped = child.kill_and_wait(KILL_TIMEOUT).await;",
    ] {
        assert_eq!(
            discarded(code),
            [false],
            "読む形を捨てる形と読んでいる: {code}"
        );
    }

    // 待ち手の中の OS への頼みには当てない
    assert!(kill_call_heads("if let Err(e) = child.start_kill() {").is_empty());
}
