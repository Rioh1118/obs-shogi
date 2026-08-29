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

/// `#[command]` と `#[tauri::command]` の両方。表記はこの crate の中で割れている。
/// **閉じ括弧まで含めない。** Tauri は `#[tauri::command(async)]` や
/// `#[tauri::command(rename_all = "snake_case")]` も正規の書き方として認めており、
/// 完全一致にすると、その形で足されたコマンドが走査から丸ごと消える
const ATTRIBUTES: [&str; 2] = ["#[command", "#[tauri::command"];

/// root 配下かを確かめる関門
const GUARD: &str = "validate_under_root";

/// 関門のほかに、そのコマンドだけが呼ばなければならないもの。
///
/// `validate_under_root` は `root == target` を「配下」として通すので、
/// **root 自身を壊す操作は別に止める必要がある**。UI 側にも判定はあるが、
/// あちらは設定に保存した文字列と canonicalize したパスを比べていて、
/// symlink を1つ挟むと一致しない。守れる層で止める
const EXTRA_GUARDS: [(&str, &str); 2] = [
    ("delete_directory", "is_project_root"),
    ("mv_directory", "is_move_into_itself"),
];

/// パスを引数の**型の中**で受け取るコマンド。署名の字面には出ないので手で並べる。
/// 構造体でパスを受けるコマンドを足したら、ここにも足すこと
const STRUCT_CARRIED_PATH: [&str; 3] = ["write_kifu_to_file", "open_project", "save_config"];

/// 関門を通さないコマンドと、その理由。
///
/// **理由なしで足さない。** 並んでよいのは次の2種類だけ。
///
/// 1. ワークスペースとは別の場所を意図して触るもの
/// 2. root を決める側。関門より前に呼ばれるので通しようがないもの（issue 番号を伴わせる）
///
/// 「まだ直していない」は理由にならない
const EXEMPT: [(&str, &str); 5] = [
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
        "(2) 索引を張る対象の root を受け取る側。root を決める前に呼ばれる → TODO(#215)",
    ),
    (
        "save_config",
        "(2) root_dir を決める側。関門を掛けると root を設定できなくなる → TODO(#215)",
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
    // 属性の括弧（`#[tauri::command(async)]` や `#[allow(...)]`）を署名と取り違えない
    let Some(signature_start) = chunk.find("fn ") else {
        return false;
    };
    let chunk = &chunk[signature_start..];
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

    let mut missing_extra: Vec<String> = Vec::new();
    for (_, source) in &files {
        for (name, body) in commands(source) {
            for (command, guard) in EXTRA_GUARDS {
                if name == command && !body.contains(guard) {
                    missing_extra.push(format!("{command} が {guard} を呼んでいない"));
                }
            }
        }
    }
    assert!(
        missing_extra.is_empty(),
        "root 自身を壊す操作を止めていない:\n{}",
        missing_extra.join("\n")
    );

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
    // `AppConfig` は中に root_dir を持つが署名からは見えない。
    // 署名で拾えないものは `STRUCT_CARRIED_PATH` の側で名指しする
    assert!(!takes("app: AppHandle, config: AppConfig"));
}

#[test]
fn the_scan_survives_attributes_with_arguments() {
    let source = r#"
#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub async fn a(app: AppHandle, file_path: String) -> () {
    validate_under_root(&app, &p);
}
"#;

    let found = commands(source);
    assert_eq!(found.len(), 1, "引数付きの属性を拾えていない");
    assert_eq!(found[0].0, "a");
    assert!(
        takes_a_path(&found[0].1),
        "属性の括弧を署名と取り違えている"
    );
}

/// `EXEMPT` と `STRUCT_CARRIED_PATH` に書いた名前が実在しないと、
/// 綴りを間違えた瞬間にその行が黙って無効になる
#[test]
fn every_listed_name_is_a_real_command() {
    let names: Vec<String> = rust_files(Path::new("src"))
        .iter()
        .flat_map(|(_, source)| commands(source))
        .map(|(name, _)| name)
        .collect();

    for (listed, _) in EXEMPT {
        assert!(names.iter().any(|n| n == listed), "EXEMPT: {listed} が無い");
    }
    for listed in STRUCT_CARRIED_PATH {
        assert!(
            names.iter().any(|n| n == listed),
            "STRUCT_CARRIED_PATH: {listed} が無い"
        );
    }
}

/// `EXEMPT` の理由に書いた `TODO(#N)` が、実際にソースへ置かれているか。
/// 置かれていないと、免除されていること自体がコードから辿れない
#[test]
fn every_todo_in_a_reason_exists_in_the_source() {
    let sources: String = rust_files(Path::new("src"))
        .iter()
        .map(|(_, source)| source.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    for (name, reason) in EXEMPT {
        let Some(at) = reason.find("TODO(#") else {
            continue;
        };
        let end = reason[at..]
            .find(')')
            .map(|e| at + e + 1)
            .unwrap_or(reason.len());
        let todo = &reason[at..end];
        assert!(
            sources.contains(todo),
            "{name} の理由が指す {todo} がソースに無い"
        );
    }
}
