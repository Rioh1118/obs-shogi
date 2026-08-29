//! パスを受け取る Tauri コマンドが、必ず root 配下かを確かめていることを見る。
//!
//! 関門を「各コマンドが自分で呼ぶ」形にしてあるので、**呼び忘れが静的には見えない**。
//! 呼び忘れたコマンドは、webview 側から任意のパスを渡せる状態でコンパイルも通る。
//!
//! `src/file_system/` を**実行時に列挙する**。ファイル一覧を手書きにすると、
//! 新しいファイルを足したときに検査の対象から外れて緑のまま通る。
//!
//! 見ているのは「関門を呼んでいるか」だけ。関門そのものは `root_dir` が
//! 未設定のときに無条件で開く（`utils.rs` の `validate_under_root`）。

use std::fs;
use std::path::Path;

/// `#[command]` と `#[tauri::command]` の両方。表記はこの crate の中で割れている
const ATTRIBUTES: [&str; 2] = ["#[command]", "#[tauri::command]"];

/// root 配下かを確かめる関門
const GUARD: &str = "validate_under_root";

/// 除外。名前と理由をここに並べる。空にできるならそれが一番よい
const EXEMPT: [&str; 0] = [];

/// `//` 行コメントを落とす。関数名をコメントに書く習慣があるので、
/// 落とさないと「呼んでいない」を「呼んでいる」と読み違える
fn without_line_comments(source: &str) -> String {
    source
        .lines()
        .map(|line| match line.find("//") {
            Some(at) => &line[..at],
            None => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 属性から次の属性までを1つのコマンドとして切り出す。構文解析はしない
fn commands(source: &str) -> Vec<(String, String)> {
    let cleaned = without_line_comments(source);
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
    for (index, &start) in marks.iter().enumerate() {
        let end = marks.get(index + 1).copied().unwrap_or(cleaned.len());
        let chunk = &cleaned[start..end];
        let name = chunk
            .split("pub fn ")
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

fn rust_files(dir: &Path) -> Vec<(String, String)> {
    let mut found = Vec::new();
    for entry in fs::read_dir(dir).expect("src/file_system を読めない") {
        let path = entry.expect("ディレクトリの項目を読めない").path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        found.push((name, fs::read_to_string(&path).expect("ファイルを読めない")));
    }
    found
}

#[test]
fn every_path_taking_command_checks_the_root() {
    let files = rust_files(Path::new("src/file_system"));
    assert!(
        files.len() >= 5,
        "src/file_system の .rs を列挙できていない: {}",
        files.len()
    );

    let mut total = 0;
    let mut missing: Vec<String> = Vec::new();

    for (file, source) in &files {
        for (name, body) in commands(source) {
            total += 1;
            if EXEMPT.contains(&name.as_str()) || body.contains(GUARD) {
                continue;
            }
            missing.push(format!("{file}: {name}"));
        }
    }

    // 0件で緑になる形を作らない。切り出しが壊れたらここで気づく
    assert!(
        total >= 12,
        "コマンドを {total} 件しか見つけられていない。切り出しが壊れている"
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
        pub fn a(app: AppHandle) -> () { validate_under_root(&app, &p); }

        #[command]
        pub fn b(app: AppHandle) -> () { }
    "#;

    let found = commands(source);
    assert_eq!(found.len(), 2, "属性の表記が違うと拾えていない");
    assert_eq!(found[0].0, "a");
    assert_eq!(found[1].0, "b");
}

#[test]
fn a_comment_mentioning_the_guard_does_not_count_as_calling_it() {
    let source = r#"
        #[command]
        pub fn a(app: AppHandle) -> () {
            // validate_under_root は親で済むので不要
        }
    "#;

    let (_, body) = commands(source).remove(0);
    assert!(
        !body.contains(GUARD),
        "コメントの中の関数名を、呼び出しとして数えている"
    );
}
