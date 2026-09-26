//! エンジンを落とした結果を捨てない。
//!
//! `EngineChild::kill` は落とすのを頼むだけで、既に頼んであった・既に終わっていた、
//! も返す（`KillRequest`）。**頼めた回だけ、終わるのを見届ける必要がある。**
//! 戻り値を `let _ =` で捨てると、見届けずに「落とした」と扱うことになり、
//! 残ったことを知る手掛かりが1本も無くなる——落とし手はどの経路も1回きりで、
//! `SPAWN_TIMEOUT` を超えた子に至ってはどの台帳にも居ない
//! （`registry.rs` の `starting` の doc、#381）。
//!
//! **捨てた側は緑のまま**（`#[must_use]` は `let _ =` を止めない）。
//! 数えるのではなく 0 で固定して、増やす側に説明を書かせる。
//!
//! 通すのは、**結果を読む**形だけ（`match` / `if let` / `?` / 束縛）。
//! 記録しない判断をしたいなら、その理由をコメントではなくログに書くこと。

mod roots;
mod scanning;

use scanning::production_code_of;

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

/// `EngineChild::kill` を呼んでいる行か（`child.kill()` / `self.child.kill()`）。
///
/// **`start_kill()` は対象外**——待ち手のタスクの中の OS への頼みで、
/// 結果はそこでログに残している。
fn calls_handler_kill(line: &str) -> bool {
    line.contains("child.kill()")
}

/// 戻り値を捨てている行か。
fn discards_result(line: &str) -> bool {
    line.trim_start().starts_with("let _ =")
}

#[test]
fn a_failed_kill_is_never_discarded() {
    let mut offenders = Vec::new();

    for path in sources() {
        for (number, line) in production_code(&path).lines().enumerate() {
            if calls_handler_kill(line) && discards_result(line) {
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
            production_code(path)
                .lines()
                .filter(|line| calls_handler_kill(line))
                .map(|line| format!("{}  {}", path.display(), line.trim()))
                .collect::<Vec<_>>()
        })
        .collect();

    assert!(
        calls.len() >= 2,
        "`child.kill()` の呼び口を {} 件しか見つけられていない。\
         綴りが変わったなら `calls_handler_kill` を直すこと",
        calls.len()
    );
}

/// 述語そのものを、文字列を直に食わせて確かめる。
///
/// **現物を食わせて違反0、では述語が壊れても緑になる。**
#[test]
fn the_predicates_split_reading_from_discarding() {
    assert!(discards_result("        let _ = self.child.kill();"));
    assert!(!discards_result("        let request = child.kill();"));
    assert!(!discards_result("        match self.child.kill() {"));

    assert!(calls_handler_kill("let _ = child.kill();"));
    assert!(calls_handler_kill("match self.child.kill() {"));
    // 待ち手の中の OS への頼みには当てない
    assert!(!calls_handler_kill("if let Err(e) = child.start_kill() {"));
}
