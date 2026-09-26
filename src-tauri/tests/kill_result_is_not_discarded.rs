//! エンジンを落とした結果を捨てない。
//!
//! `EngineChild::kill_and_wait` は、落とせたか・上限内に終わらなかったか（**残っている**）
//! を返す（`KillOutcome`）。戻り値を `let _ =` で捨てると、残ったことを知る手掛かりが
//! 1本も無くなる——落とし手はどの経路も1回きりで、`SPAWN_TIMEOUT` を超えた子に至っては
//! どの台帳にも居ない（`registry.rs` の `starting` の doc、#381）。
//!
//! **捨てた側は緑のまま。** `#[must_use]` は `let _ =` も `let _x =` も `_ =`（`select!` の
//! 枝も）止めない。ブロックの末尾の式にすると、値はブロックのものとして使われたことになり、
//! 何も言われない（`tokio::spawn(async move { child.kill_and_wait(..).await })`）。
//! `drop(..)` を止めるのは、`KillOutcome` が `Copy` である間の `dropping_copy_types` だけ。
//!
//! **許可制にする。** 通すのは、結果を読む形（`reads_the_result`）だけで、それ以外は全部落とす。
//! 捨てる形を数え上げると、数え漏れた形が素通りする。記録しない判断をしたいなら、
//! その理由をコメントではなくログに書くこと。
//!
//! **行ではなく文で見る。** rustfmt は長い受け手の鎖を折り返すので、
//! `kill_and_wait(` の行に `let _ =` が載っているとは限らない。

mod roots;
mod scanning;

use scanning::{production_code_of, skip_literal_or_comment};

use std::collections::BTreeSet;
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

/// 本番で `kill_and_wait` を呼んでいる場所の控え（`src-tauri` からの相対パス）。
///
/// **等値で見る。** 減ったら、走査が空振りしたか、包む関数ができて綴りが変わった合図。
/// 増えたら、新しい呼び口も上の検査を通っていることを確かめてから足す。
const KILL_CALL_SITES: [&str; 2] = ["src/engine/protocol.rs", "src/engine/registry.rs"];

/// `kill_and_wait(` の呼び口ごとに、`(行番号, その文の頭から呼び口の手前まで)` を返す。
///
/// 文の頭は直前の `;` / `{` / `}` の後ろ。**文字列・文字・コメントの中の区切りは数えない**
/// （`skip_literal_or_comment`）——`f("{", child.kill_and_wait(..))` の `{` で頭を切ると、
/// `let _ =` が見えなくなる。返す頭は空白を1つに畳む。
///
/// 定義（頭が `fn` で終わる `fn kill_and_wait(`）は呼び口ではないので返さない。
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
            if head.last() != Some(&"fn") {
                heads.push((code[..at].matches('\n').count() + 1, head.join(" ")));
            }
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

/// 文の頭が、戻り値を読む形か。**ここに無い形は全部「捨てる」として落とす。**
///
/// - `match` / `if let` / `while let` の対象にする
/// - `return` で呼び手へ返す
/// - `_` で始まらない名前に束縛する・代入する（`let outcome =` / `let mut outcome =` /
///   `outcome =`）。下線で始まる名前は、読まなくても警告が出ない
fn reads_the_result(head: &str) -> bool {
    let words: Vec<&str> = head.split_whitespace().collect();
    let named = |word: &&str| !word.starts_with('_');
    match words.as_slice() {
        ["match", ..] | ["return", ..] | ["if", "let", ..] | ["while", "let", ..] => true,
        ["let", "mut", name, ..] => named(name),
        ["let", name, ..] => named(name),
        [name, "=", ..] => named(name),
        _ => false,
    }
}

#[test]
fn a_failed_kill_is_never_discarded() {
    let mut offenders = Vec::new();

    for path in sources() {
        for (line, head) in kill_call_heads(&production_code(&path)) {
            if !reads_the_result(&head) {
                offenders.push(format!("{}:{line}  {head}{KILL_CALL}", path.display()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "`kill_and_wait` の結果を読んでいない。上限内に終わらなかった回（`TimedOut`）は\
         プロセスが残るので、`TimedOut` / `WatcherGone` を1行ログに残すこと。\
         読んでいるのにここに出たなら、その形を `reads_the_result` に足すこと:\n{}",
        offenders.join("\n")
    );
}

/// 走査が空振りしても違反0になる。**呼び口が見えていること**を控えとの等値で固定する。
///
/// 綴りが変わった（`kill_and_wait` を包む関数ができた、名前を変えた）だけで、
/// 上の検査は静かに緑になる。ここが先に落ちる。
#[test]
fn the_scanner_still_sees_the_kill_call_sites() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let sites: BTreeSet<String> = sources()
        .iter()
        .filter(|path| !kill_call_heads(&production_code(path)).is_empty())
        .map(|path| {
            path.strip_prefix(root)
                .unwrap_or(path)
                .display()
                .to_string()
        })
        .collect();

    assert_eq!(
        sites,
        KILL_CALL_SITES.map(String::from).into(),
        "`kill_and_wait` を呼ぶ場所が控え（`KILL_CALL_SITES`）と違う。減ったなら、\
         `KILL_CALL` の綴りか、包む関数ができていないかを見ること。増えたなら控えに足す"
    );
}

/// 文の頭を取って、読む形かを見る。**文字列を直に食わせる。**
fn reads(code: &str) -> Vec<bool> {
    kill_call_heads(code)
        .into_iter()
        .map(|(_, head)| reads_the_result(&head))
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
        "        _ = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        tokio::select! {\n            _ = child.kill_and_wait(KILL_TIMEOUT) => {}\n        }",
        "        tokio::spawn(async move { child.kill_and_wait(KILL_TIMEOUT).await });",
        "        child.kill_and_wait(KILL_TIMEOUT).await;",
        "        drop(child.kill_and_wait(KILL_TIMEOUT).await);",
        "        std::mem::drop(child.kill_and_wait(KILL_TIMEOUT).await);",
        // 文字列の中の区切りで文の頭を切らない
        "        let _ = log_after(\"{;}\", child.kill_and_wait(KILL_TIMEOUT).await);",
    ] {
        assert_eq!(reads(code), [false], "捨てる形を読む形と読んでいる: {code}");
    }

    // 読む形。直前の文の `let _ =` を引きずらない
    for code in [
        "        let outcome = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        let mut outcome = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        let outcome: KillOutcome = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        let dropped = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        outcome = child.kill_and_wait(KILL_TIMEOUT).await;",
        "        match self.child.kill_and_wait(KILL_TIMEOUT).await {",
        "        let _ = before();\n        match child.kill_and_wait(KILL_TIMEOUT).await {",
        "        if let KillOutcome::TimedOut = child.kill_and_wait(KILL_TIMEOUT).await {",
        "        return child.kill_and_wait(KILL_TIMEOUT).await;",
    ] {
        assert_eq!(reads(code), [true], "読む形を捨てる形と読んでいる: {code}");
    }

    // 定義は呼び口ではない。待ち手の中の OS への頼みにも当てない
    assert!(kill_call_heads(
        "    pub async fn kill_and_wait(&self, limit: Duration) -> KillOutcome {"
    )
    .is_empty());
    assert!(kill_call_heads("if let Err(e) = child.start_kill() {").is_empty());
}
