//! 定跡コマンドの入口が持つ、**戻り値に現れない性質**を固定する。
//!
//! `src/book/commands.rs` の入口は `block_on` で呼べるので振る舞いは単体テストで見られるが、
//! そこで見えるのは戻り値だけ。**下は全て、戻り値が同じまま壊れる。**
//! 何を見ているかはこの下の `#[test]` を読むこと（数を書くと、足した人が必ず腐らせる）。
//!
//! - 重い処理を blocking プールへ逃がしているか（外しても結果は同じ。
//!   止まるのは同時に走る他のコマンドで、テストは1本ずつしか走らせない）
//! - ログにパスを打ち切って書いているか（長さは戻り値に出ない。
//!   溢れるのは 200KB でローテートするログのほう）
//! - `Unknown` の復帰案内が open と lookup で入れ替わっていないか
//!   （この枝は blocking プールの panic でしか踏まない）
//! - 失敗がログに残るか（`logged` は残すためだけに在る）
//!
//! **走査で固定するのは、単体テストで書けないからではなく、書いても緑になるから。**
//! 実際に `spawn_blocking` を外す変異を当てても入口の往復テストは通る。

mod scanning;
use scanning::{blank_out_comments, matching};

use std::fs;
use std::path::{Path, PathBuf};

/// 入口に在るべきログの本数。**緩い下限にしない**（理由は使う側）。
const EXPECTED_LOG_LINES: usize = 5;

/// blocking プールへ逃がすべき呼び出し。
///
/// どれも入口の async 関数から呼ばれ、収録局面ぶんの確保か解放を伴う。
/// 逃がさないと async ランタイムのワーカを占有し、**他のコマンドの応答が止まる。**
const HEAVY_CALLS: [&str; 3] = ["open_at(", "reader.lookup(", "drop(value)"];

fn entry_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/book/commands.rs")
}

/// 入口の本体（テストモジュールを含まない）。
fn entry_source() -> String {
    let raw = fs::read_to_string(entry_path()).expect("入口が読めない");
    // コメントの中の言及は見ない。この検査の理由を書けなくなる
    let code = blank_out_comments(&raw);
    match code.find("\nmod tests {") {
        Some(at) => code[..at].to_string(),
        None => code,
    }
}

/// 名前で関数の本体を切り出す。無ければ `None`。
///
/// 名前の直後は `(` とは限らない（`fn logged<T>(`）。前方一致だけで拾うと
/// 長い名前の関数を短い名前で引き当てるので、次の1文字まで見る。
fn body_of(code: &str, name: &str) -> Option<String> {
    let head = format!("fn {name}");
    let at = code
        .match_indices(&head)
        .find(|(i, _)| matches!(code[i + head.len()..].chars().next(), Some('(') | Some('<')))
        .map(|(i, _)| i)?;
    let open = code[at..].find('{')? + at;
    let close = matching(&code[open..], '{', '}')? + open;
    Some(code[open..=close].to_string())
}

#[test]
fn the_heavy_calls_stay_off_the_async_runtime() {
    let code = entry_source();
    let lines: Vec<&str> = code.lines().collect();

    let mut offenders = Vec::new();
    let mut scanned = 0;

    for (number, line) in lines.iter().enumerate() {
        if !HEAVY_CALLS.iter().any(|call| line.contains(call)) {
            continue;
        }
        scanned += 1;
        // 引数が折り返ると `spawn_blocking` は数行手前へ行く
        let from = number.saturating_sub(3);
        let block = lines[from..=number].join("\n");
        if escapes_the_async_runtime(&block) {
            continue;
        }
        offenders.push(format!(
            "src/book/commands.rs:{}  {}",
            number + 1,
            line.trim()
        ));
    }

    assert_eq!(
        scanned,
        HEAVY_CALLS.len(),
        "重い呼び出しを {scanned} 本しか見ていない。\
         綴りが変わったなら HEAVY_CALLS を直すこと"
    );
    assert!(
        offenders.is_empty(),
        "重い処理が async ランタイムのワーカで走る:\n{}\n\
         `tauri::async_runtime::spawn_blocking` へ包むこと。",
        offenders.join("\n")
    );
}

/// `log::` の行から、そのマクロ呼び出しの閉じ括弧までを取り出す。
///
/// 括弧が閉じない（開き括弧が無い、対応が取れない）なら、その行だけを返す。
fn macro_call_at(code: &str, lines: &[&str], number: usize) -> String {
    let from: usize = lines[..number].iter().map(|l| l.len() + 1).sum();
    let Some(open) = code[from..].find('(').map(|at| from + at) else {
        return lines[number].to_string();
    };
    match matching(&code[open..], '(', ')') {
        Some(close) => code[from..=open + close].to_string(),
        None => lines[number].to_string(),
    }
}

#[test]
fn the_log_line_truncates_the_path() {
    let code = entry_source();
    let lines: Vec<&str> = code.lines().collect();

    let mut offenders = Vec::new();
    let mut scanned = 0;

    for (number, line) in lines.iter().enumerate() {
        if !line.contains("log::") {
            continue;
        }
        scanned += 1;
        // **固定行数の窓にしない。** rustfmt は引数が増えると `log::info!(` を
        // 折り返すので、3行の窓だと `input.path` が窓の外へ落ちて素通しする。
        // マクロ呼び出しの閉じ括弧までを1つの塊として渡す。
        let block = macro_call_at(&code, &lines, number);
        if !logs_a_raw_path(&block) {
            continue;
        }
        offenders.push(format!(
            "src/book/commands.rs:{}  {}",
            number + 1,
            line.trim()
        ));
    }

    // **ログの行だけを見ても足りない。** 生パスを一度ローカルに束縛してから
    // `{shown}` で埋め込むと、`log::` の塊には `input.path` の綴りが1つも出ない。
    // 入口の本体ごと見て、`input.path` の出現を許す形に限る。
    for name in ["open_book_inner", "lookup_inner", "close_book_inner"] {
        let Some(body) = body_of(&code, name) else {
            continue;
        };
        for (at, _) in body.match_indices("input.path") {
            let before = &body[..at];
            // 許すのは3つだけ。**検査に渡す**（`validate_book_path`）、
            // **打ち切ってログへ出す**（`truncate_path`）、
            // **失敗に添える**（`join_error`。`BookError::with_path` が打ち切る）。
            if ["validate_book_path(&", "truncate_path(&", "join_error("]
                .iter()
                .any(|allowed| before.ends_with(allowed))
            {
                continue;
            }
            offenders.push(format!("{name} が利用者の入力を素のまま持ち回している"));
        }
    }

    // **等値で見る。** 緩い下限だと、守るはずのログ地点が1本消えても満たされる
    // （`open_book` がどのパスを開いたかを残す唯一の行が消えても緑になった）。
    // 増えた側で赤くなるのは正しい —— 増やした人に、それも打ち切りを通るのかを見させる。
    assert_eq!(
        scanned, EXPECTED_LOG_LINES,
        "log の行が {scanned} 本。増減したなら EXPECTED_LOG_LINES を実測へ直すこと"
    );
    assert!(
        offenders.is_empty(),
        "利用者の入力をそのままログへ書いている:\n{}\n\
         `truncate_path` を通すこと（ログは 200KB でローテートする）。",
        offenders.join("\n")
    );
}

#[test]
fn the_recovery_matches_the_call_site() {
    let code = entry_source();

    let open = body_of(&code, "open_book_inner").expect("open_book_inner が見つからない");
    let lookup = body_of(&code, "lookup_inner").expect("lookup_inner が見つからない");

    assert!(
        open.contains("join_error(") && !open.contains("Some("),
        "open の途中ではハンドルがまだ無い。`join_error` には `None` を渡すこと:\n{open}"
    );
    assert!(
        lookup.contains("join_error(") && lookup.contains("Some(input.handle)"),
        "lookup では引いた先のハンドルがある。`join_error` にはそれを渡すこと:\n{lookup}"
    );
}

#[test]
fn the_only_place_that_records_failures_still_records_them() {
    let code = entry_source();
    let logged = body_of(&code, "logged").expect("logged が見つからない");

    assert!(
        logged.contains("log::"),
        "`logged` は失敗をログに残すためだけに在る。\
         書かなくなっても戻り値は変わらないので、\
         「定跡が開けない」という報告を受けたときに原因を切り分けられなくなる:\n{logged}"
    );
}

/// **既知の違反を、判定が実際に offender と読むこと。**
///
/// 走査は「引き金の行を数える」までしか自分を見ていない。判定のほうが
/// 何も落とさなくなっても件数は変わらないので、**判定そのものに入力を食わせる。**
#[test]
fn a_known_offender_is_still_caught() {
    assert!(!escapes_the_async_runtime(
        "    let opened = open_at(&path);"
    ));
    assert!(escapes_the_async_runtime(
        "    spawn_blocking(move || open_at(&path))"
    ));
    // 折り返っても手前の行に見える
    assert!(escapes_the_async_runtime(
        "    tauri::async_runtime::spawn_blocking(\n        move || open_at(&path),\n    )"
    ));

    assert!(logs_a_raw_path(
        r#"log::info!("[cmd] open_book path={}", input.path);"#
    ));
    assert!(!logs_a_raw_path(
        r#"log::info!("[cmd] open_book path={}", truncate_path(&input.path));"#
    ));
    // パスを含まないログは対象外
    assert!(!logs_a_raw_path(r#"log::info!("[cmd] closed={closed}");"#));
    // **窓を跨いだ言及で無罪にしない。** 隣の行に綴りがあるだけの形
    assert!(logs_a_raw_path(
        "log::info!(\"path={}\", input.path);\n    let _shown = truncate_path(&input.path);"
    ));
    // **折り返しで窓の外へ出さない。** rustfmt が引数を1行ずつに割った形
    assert!(logs_a_raw_path(
        "log::info!(\n        \"[cmd] open_book handle={} format={} path={}\",\n\
         \x20       0u64,\n        \"db\",\n        input.path\n    )"
    ));
    // 折り返して引数の位置に居る形は通す
    assert!(!logs_a_raw_path(
        "log::info!(\n        \"path={}\",\n        truncate_path(&input.path)\n    );"
    ));

    // 本体を切り出せること。**入れ子の `}` で早く閉じない** ——
    // 早く閉じると `join_error` の行を含まない断片を見て、対応の検査が空振りする
    let sample = "async fn f(a: u8) -> u8 {\n    if a > 0 {\n        return 1;\n    }\n    0\n}\nfn g() {}\n";
    let body = body_of(sample, "f").expect("本体を切り出せない");
    assert!(body.contains("return 1;"), "{body}");
    assert!(!body.contains("fn g"), "本体を跨いで切り出している: {body}");
    assert!(body_of(sample, "missing").is_none());
    // 名前の直後が `<` でも引き当てること（`fn logged<T>(`）
    let generic = "fn logged<T>(x: T) -> T {\n    x\n}\n";
    assert!(body_of(generic, "logged").is_some());
    // 短い名前で長い名前を引き当てないこと
    assert!(body_of(generic, "log").is_none());
}

/// 走査の判定そのもの。**テストと本体で同じものを通す。**
fn escapes_the_async_runtime(block: &str) -> bool {
    block.contains("spawn_blocking")
}

/// 利用者の入力が、**打ち切りを通らずに**ログへ乗っているか。
///
/// **窓の中に `truncate_path` の綴りがあるかで見ない。** それだと
/// `log::info!("… {}", input.path); let _ = truncate_path(&input.path);` のように
/// 隣の行で名前を出すだけで無罪になる（実測で生き残った）。
/// 見るのは「`input.path` の出現が、打ち切りの引数の位置にあるか」だけ。
fn logs_a_raw_path(block: &str) -> bool {
    block
        .match_indices("input.path")
        .any(|(at, _)| !block[..at].ends_with("truncate_path(&"))
}
