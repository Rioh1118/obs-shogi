//! パスを受け取る Tauri コマンドが、必ず root 配下かを確かめていることを見る。
//!
//! 関門を「各コマンドが自分で呼ぶ」形にしてあるので、**呼び忘れが静的には見えない**。
//! 呼び忘れたコマンドは、webview 側から任意のパスを渡せる状態でコンパイルも通る。
//!
//! `src/` を**再帰で実行時に列挙する**。ファイルもディレクトリも手書きにすると、
//! 置き場を変えただけで検査の対象から外れて緑のまま通る。
//!
//! これは crate をリンクせず、ソースを文字列として読む検査。crate の内部を
//! 見るテストは `src` 側の `#[cfg(test)]` に置く（`CONTRIBUTING.md` の
//! 「機械で止めているもの」を参照）。
//!
//! 見ているのは「関門を呼んでいるか」だけ。関門そのものは `root_dir` が
//! 未設定のときに無条件で開く（`utils.rs` の `validate_under_root`）。

use std::fs;
use std::path::Path;

/// `#[command]` と `#[tauri::command]` の両方。表記はこの crate の中で割れている
const ATTRIBUTES: [&str; 2] = ["#[command]", "#[tauri::command]"];

/// root 配下かを確かめる関門
const GUARD: &str = "validate_under_root";

/// パスを引数の**型の中**で受け取るコマンド。署名の字面には出ないので手で並べる。
/// 構造体でパスを受けるコマンドを足したら、ここにも足すこと
const STRUCT_CARRIED_PATH: [&str; 2] = ["write_kifu_to_file", "open_project"];

/// 関門を通さないコマンドと、その理由。
///
/// **理由なしで足さない。** ここに並ぶのは「ワークスペースとは別の場所を
/// 意図して触る」ものだけで、「まだ直していない」ものではない
const EXEMPT: [(&str, &str); 4] = [
    (
        "scan_ai_root",
        "ai_root はワークスペースとは別に利用者が選ぶ場所。root 配下に無い",
    ),
    ("ensure_engines_dir", "同上。ai_root の下に engines/ を作る"),
    (
        "initialize_engine",
        "engine_path は思考エンジンの実行ファイル。ワークスペースの外にある",
    ),
    (
        "open_project",
        "索引を張る対象の root を受け取る側。root を決める前に呼ばれる → TODO(#215)",
    ),
];

/// `/* */` と `//` を落とす。関数名をコメントに書く習慣があるので、
/// 落とさないと「呼んでいない」を「呼んでいる」と読み違える。
///
/// 文字列リテラルの中の `//`（`"https://..."` など）もコメントとして落ちる。
/// 落ちるのはその行の残りだけで、起きるのは偽陽性（呼んでいるのに見えない）なので、
/// 字句解析はしない
fn without_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let bytes = source.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"/*") {
            match source[i + 2..].find("*/") {
                Some(at) => i += 2 + at + 2,
                None => break,
            }
            continue;
        }
        if bytes[i..].starts_with(b"//") {
            match source[i..].find('\n') {
                Some(at) => i += at,
                None => break,
            }
            continue;
        }
        out.push(source[i..].chars().next().expect("境界がずれている"));
        i += source[i..]
            .chars()
            .next()
            .map(|c| c.len_utf8())
            .expect("境界がずれている");
    }
    out
}

/// 属性から**その関数の閉じ括弧まで**を1つのコマンドとして切り出す。
///
/// 次の属性までにすると、あいだに挟まった別の関数の中身が本体に混ざる。
/// 関門をその別の関数が呼んでいるだけで、コマンド側は呼び忘れたまま緑になる。
/// rustfmt が最上位の `}` を列0に置くので、それを終端に使う（構文解析はしない）
fn commands(source: &str) -> Vec<(String, String)> {
    let cleaned = without_comments(source);
    let mut marks: Vec<usize> = Vec::new();
    for attribute in ATTRIBUTES {
        let mut from = 0;
        while let Some(at) = cleaned[from..].find(attribute) {
            marks.push(from + at);
            from += at + attribute.len();
        }
    }
    marks.sort_unstable();

    let mut found = Vec::new();
    for &start in &marks {
        let end = cleaned[start..]
            .find("\n}")
            .map(|at| start + at + 2)
            .unwrap_or(cleaned.len());
        let chunk = &cleaned[start..end];
        // `pub` / `pub(crate)` / `async` のどれが付いていても名前を取れるようにする
        let name = chunk
            .split("fn ")
            .nth(1)
            .and_then(|rest| {
                rest.split(|c: char| !c.is_alphanumeric() && c != '_')
                    .next()
            })
            .unwrap_or("")
            .to_string();
        found.push((name, chunk.to_string()));
    }
    found
}

/// 署名がパスらしきものを受け取っているか。
/// 引数名の末尾が `path` / `dir` / `root` のもの、および `Path` / `PathBuf` を見る
fn takes_a_path(chunk: &str) -> bool {
    let Some(open) = chunk.find('(') else {
        return false;
    };
    let Some(close) = chunk.find(')') else {
        return false;
    };
    if close < open {
        return false;
    }
    let signature = &chunk[open..close];

    if signature.contains("PathBuf") || signature.contains("Path") {
        return true;
    }
    signature.split(',').any(|argument| {
        let Some((name, _)) = argument.split_once(':') else {
            return false;
        };
        let name = name.trim();
        name.ends_with("path") || name.ends_with("dir") || name.ends_with("root")
    })
}

fn rust_files(dir: &Path) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).expect("ディレクトリを読めない") {
        let path = entry.expect("ディレクトリの項目を読めない").path();
        if path.is_dir() {
            found.extend(rust_files(&path));
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        found.push((
            path.to_string_lossy().to_string(),
            fs::read_to_string(&path).expect("ファイルを読めない"),
        ));
    }
    found
}

#[test]
fn every_path_taking_command_checks_the_root() {
    let files = rust_files(Path::new("src"));
    assert!(
        files.len() >= 20,
        "src の .rs を列挙できていない: {}",
        files.len()
    );

    let mut all = 0;
    let mut path_taking: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();

    for (file, source) in &files {
        for (name, body) in commands(source) {
            all += 1;
            if !takes_a_path(&body) && !STRUCT_CARRIED_PATH.contains(&name.as_str()) {
                continue;
            }
            path_taking.push(name.clone());
            if EXEMPT.iter().any(|(exempt, _)| *exempt == name) || body.contains(GUARD) {
                continue;
            }
            missing.push(format!("{file}: {name}"));
        }
    }

    // 0件で緑になる形を作らない。切り出しが壊れたらここで気づく
    assert!(
        all >= 30,
        "コマンドを {all} 件しか見つけられていない。切り出しが壊れている"
    );
    assert!(
        path_taking.len() >= 17,
        "パスを受けるコマンドを {} 件しか見つけられていない。署名の判定が壊れている: {path_taking:?}",
        path_taking.len()
    );

    assert!(
        missing.is_empty(),
        "root 配下かを確かめていないコマンドがある。webview 側から任意のパスを渡せる:\n{}",
        missing.join("\n")
    );
}

#[test]
fn the_scan_survives_both_attribute_spellings() {
    let source = r#"
#[tauri::command]
pub fn a(app: AppHandle, file_path: String) -> () { validate_under_root(&app, &p); }

#[command]
pub async fn b(app: AppHandle, dir_path: String) -> () {
}
"#;

    let found = commands(source);
    assert_eq!(found.len(), 2, "属性の表記が違うと拾えていない");
    assert_eq!(found[0].0, "a");
    assert_eq!(found[1].0, "b", "async が付くと名前を取れていない");
}

#[test]
fn a_comment_mentioning_the_guard_does_not_count_as_calling_it() {
    for source in [
        r#"
#[command]
pub fn a(app: AppHandle, file_path: String) -> () {
    // validate_under_root は親で済むので不要
}
"#,
        r#"
#[command]
pub fn a(app: AppHandle, file_path: String) -> () {
    /* validate_under_root は親で済むので不要 */
}
"#,
    ] {
        let (_, body) = commands(source).remove(0);
        assert!(
            !body.contains(GUARD),
            "コメントの中の関数名を、呼び出しとして数えている:\n{source}"
        );
    }
}

#[test]
fn a_call_in_the_next_function_does_not_count_as_the_command_calling_it() {
    let source = r#"
#[command]
pub fn a(app: AppHandle, file_path: String) -> () {
}

fn helper(app: &AppHandle, p: &Path) -> () {
    validate_under_root(app, p);
}
"#;

    let (name, body) = commands(source).remove(0);
    assert_eq!(name, "a");
    assert!(
        !body.contains(GUARD),
        "コマンドの後ろにある別の関数の呼び出しを、本体として数えている"
    );
}

#[test]
fn only_signatures_that_carry_a_path_are_checked() {
    let takes =
        |signature: &str| takes_a_path(&format!("#[command]\npub fn f({signature}) {{\n}}"));

    assert!(takes("app: AppHandle, file_path: String"));
    assert!(takes("app: AppHandle, dest_dir: String"));
    assert!(takes("ai_root: String"));
    assert!(takes("p: &Path"));

    assert!(!takes("state: State<'_, AppState>, depth: u32"));
    assert!(!takes("app: AppHandle, config: AppConfig"));
}
