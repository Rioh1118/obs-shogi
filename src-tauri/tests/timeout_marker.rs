//! 時間切れの `Err` が、必ず1つの目印を持つこと。
//!
//! `startGame` が返すのはフラットな文字列なので、**再試行で通る失敗**を
//! フロントが見分ける手立ては `TIMED_OUT` の綴りしかない
//! （→ `docs/state-transitions/failure-surfacing.md` の F-27）。
//!
//! **片側だけの保証。** 目印が無ければ設定の誤り、とは言えない——
//! 内部の取り落としも目印を持たずに届く（`startGame` の TSDoc がそう書いている）。
//!
//! **人の注意では続かなかった。** 綴りを5通りから1つへ寄せた回に1件取りこぼし、
//! その1件が起動段で**いちばん当たりやすい**時間切れ（`usiok` が来ない）だった。
//! 落ちたときに利用者が見るのは「エンジンのパスを直せ」で、直すものは1つも無い。
//!
//! ## 走査が要求すること
//!
//! 見るのは `EngineError::Timeout(` の**実引数の綴り**だけ。
//! **変数へ括り出すと、目印が入っていても落ちる**（実引数が識別子1個になるので、
//! 走査からは中身が見えない）。長い `format!` を括り出したくなったら、
//! 目印だけは実引数側に残すこと。
//!
//! 時間切れを `Timeout` 以外のバリアントで返す形は見ていない。

mod scanning;

use scanning::{find_in_code, matching, production_code_of};

use std::fs;
use std::path::{Path, PathBuf};

/// 目印そのもの。`engine/types.rs` の `TIMED_OUT` と同じ綴り
const MARKER: &str = "timed out";
/// 目印を要求する構築
const CONSTRUCTOR: &str = "EngineError::Timeout(";

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

fn engine_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/engine")
}

/// `EngineError::Timeout(...)` の実引数を、1件ずつ返す。
///
/// **本番コードだけ。** `#[cfg(test)]` の中の見本（`Timeout("blocked")`）まで
/// 要求すると、目印が「時間切れの印」ではなく「この綴りを書く儀式」になる。
fn timeout_arguments(source: &str, path: &Path) -> Vec<String> {
    let code = production_code_of(source, path);
    let mut found = Vec::new();
    let mut from = 0;

    while let Some(at) = find_in_code(&code[from..], CONSTRUCTOR) {
        let open = from + at + CONSTRUCTOR.len() - 1;
        let len = matching(&code[open..], '(', ')').unwrap_or_else(|| {
            panic!(
                "{}: `{CONSTRUCTOR}` の括弧が釣り合わない。走査が壊れている",
                path.display()
            )
        });
        let argument = code[open + 1..open + len - 1].trim().to_string();
        // **パターンは構築ではない。** `matches!(e, EngineError::Timeout(_))` の
        // `_` まで要求すると、時間切れを**見分ける**側に綴りを書かせることになる
        if argument != "_" {
            found.push(argument);
        }
        from = open + len;
    }
    found
}

/// 時間切れを作る式が、必ず目印を含むこと。
///
/// **含まないと「再試行してよい」と分からない。** プロセスは正常に起き、
/// パスも設定も正しいのに、フロントはそれを見分けられない——
/// もう一度押せば通ったはずの起動を、利用者はそこで捨てる。
#[test]
fn every_timeout_carries_the_marker() {
    let mut offenders = Vec::new();

    for path in rust_files(&engine_dir()) {
        let source = fs::read_to_string(&path).unwrap_or_default();
        let relative = path
            .strip_prefix(engine_dir())
            .unwrap_or(&path)
            .to_path_buf();
        for argument in timeout_arguments(&source, &path) {
            if !argument.contains(MARKER) && !argument.contains("TIMED_OUT") {
                offenders.push(format!("{}  {argument}", relative.display()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "時間切れの `Err` に `{MARKER}` の目印が無い。\
         フロントはこれを「設定の誤り」に分類して、再試行で通る失敗を行き止まりとして案内する:\n{}",
        offenders.join("\n")
    );
}

/// 走査が何も拾えていない状態で緑にならないこと。
///
/// **構築の綴りを変えれば黙って空振りする。** `EngineError::Timeout` を
/// `use` で持ち込んで `Timeout(...)` と書く形に変えたとき、ここが落ちて気付ける。
#[test]
fn the_scanner_finds_the_timeouts() {
    let found: usize = rust_files(&engine_dir())
        .iter()
        .map(|path| {
            let source = fs::read_to_string(path).unwrap_or_default();
            timeout_arguments(&source, path).len()
        })
        .sum();

    assert!(
        found >= 3,
        "時間切れの構築を {found} 件しか拾えていない。走査が空振りしている"
    );
}

/// 走査が本番と見本を分けていること。
///
/// **現物だけを食わせていると差が出ない。** 見本の側まで要求する形に戻しても、
/// いま `#[cfg(test)]` の中に目印無しの `Timeout` を書く人が居なければ緑のまま通る。
#[test]
fn a_sample_inside_a_test_module_is_not_required_to_carry_it() {
    let source = "\
fn real() -> Result<(), EngineError> {
    Err(EngineError::Timeout(\"timed out waiting\".to_string()))
}

#[cfg(test)]
mod tests {
    fn sample() {
        let _ = EngineError::Timeout(\"blocked\".to_string());
    }
}
";
    let found = timeout_arguments(source, Path::new("<テスト>"));
    assert_eq!(
        found.len(),
        1,
        "見本まで拾っている、または本番を落としている: {found:?}"
    );
    assert!(found[0].contains(MARKER));
}
