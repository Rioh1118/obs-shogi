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
//! 見ているのは3つ。関門を呼んでいるか、その**順序**（存在確認より前か）、
//! コマンド固有の追加の関門（`EXTRA_GUARDS`）。
//! 関門そのものは `root_dir` が未設定のときに無条件で開く
//! （`utils.rs` の `validate_under_root`）。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

/// `#[command]` と `#[tauri::command]` の両方。表記はこの crate の中で割れている。
/// **閉じ括弧まで含めない。** Tauri は `#[tauri::command(async)]` や
/// `#[tauri::command(rename_all = "snake_case")]` も正規の書き方として認めており、
/// 完全一致にすると、その形で足されたコマンドが走査から丸ごと消える
const ATTRIBUTES: [&str; 2] = ["#[command", "#[tauri::command"];

/// root 配下かを確かめる関門
const GUARD: &str = "validate_under_root";

/// 関門だけでは足りず、そのコマンドだけが呼ばなければならないもの。
///
/// - `delete_directory`: `validate_under_root` は `root == target` を「配下」として
///   通すので、ワークスペース自身の削除が素通りする（`is_project_root`）
/// - `mv_directory`: 自分の中への移動は `fs::rename` が `EINVAL` で落とし、
///   `io`（tier は warning）に丸まって効かない再読み込みが出る（`is_move_into_itself`）
/// - `create_ai_profile_dirs`: `ai_root` の外なので `validate_under_root` は掛からない。
///   名前の規則をここで書き直すと、`..` のような1つの規則を落としたときに
///   `ai_root` の外へ作れてしまう（`join("..")` は親へ抜け、`create_dir_all` は
///   途中の段も黙って作る）
const EXTRA_GUARDS: [(&str, &str); 3] = [
    ("delete_directory", "is_project_root"),
    ("mv_directory", "is_move_into_itself"),
    ("create_ai_profile_dirs", "validate_basename"),
];

/// パスを引数の**型の中**で受け取るコマンド。署名の字面には出ないので手で並べる。
///
/// **載せ忘れは静かに効く。** 載っていないコマンドは
/// `every_path_taking_command_checks_the_root` の対象に一度も入らないので、
/// 関門を呼んでいなくても、免除の理由が無くても緑で通る。
/// `no_path_carrying_command_is_missing_from_the_list` が載せ忘れを拾う。
const STRUCT_CARRIED_PATH: [&str; 5] = [
    "write_kifu_to_file",
    "open_project",
    "save_config",
    "start_game",
    "save_presets",
];

/// 関門を通さないコマンドと、その理由。
///
/// **理由なしで足さない。** 並んでよいのは次の2種類だけ。
///
/// 1. ワークスペースとは別の場所を意図して触るもの
/// 2. root を決める側。関門より前に呼ばれるので通しようがないもの（issue 番号を伴わせる）
///
/// 「まだ直していない」は理由にならない
const EXEMPT: [(&str, &str); 8] = [
    (
        "scan_ai_root",
        "(1) ai_root はワークスペースとは別に利用者が選ぶ場所。root 配下に無い",
    ),
    (
        "ensure_engines_dir",
        "(1) 同上。ai_root の下に engines/ を作る",
    ),
    (
        "create_ai_profile_dirs",
        "(1) 同上。ai_root の下にプロファイルを作る",
    ),
    (
        "initialize_engine",
        "(1) engine_path は思考エンジンの実行ファイル。ワークスペースの外にある",
    ),
    (
        "save_presets",
        "(1) EnginePreset の engine_path / eval_file_path / book_file_path は \
         思考エンジンと評価関数。ワークスペースの外にあり、ここでは開かず保存するだけ \
         （書き込み先は presets_path で、フロントは指定できない）",
    ),
    (
        "start_game",
        "(1) 同上。`GameSettings` の中の engine_path / work_dir が同じもの \
         （起こしてよいかは `EngineRegistry::spawn` の canonicalize + is_file が見る）",
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
/// 文字列リテラルの中の `//` は、その行の残りが落ちるだけ（偽陽性）。
/// **`/*` は違う。** 文字列の中にあると次の `*/` までが丸ごと落ち、その範囲の
/// `#[command]` が走査から消える（偽陰性）。いまソースに `/*` を含む文字列は無い
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

/// `validate_under_root(&app, &x)` の `(位置, x)` を全部集める。
///
/// 位置だけで比べると、パスを2本受けるコマンドの正しい並びを違反として拾ってしまう。
/// 守りたいのは「**その変数**を関門へ通す前に、その変数の存在や種類を見ない」
fn guarded_variables(body: &str) -> Vec<(usize, String)> {
    let mut found = Vec::new();
    for (at, _) in body.match_indices(GUARD) {
        let rest = &body[at..];
        let Some(open) = rest.find('(') else { continue };
        let Some(close) = rest.find(')') else {
            continue;
        };
        if close < open {
            continue;
        }
        let Some(last) = rest[open + 1..close].split(',').next_back() else {
            continue;
        };
        found.push((at, last.trim().trim_start_matches('&').to_string()));
    }
    found
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

/// 宣言された型 → その中に現れる型の名前。`struct` も `enum` も同じ扱い。
///
/// バリアントの中の欄も本体の欄も、`名前: 型` の形は同じなので割らない。
fn type_graph(files: &[(String, String)]) -> TypeGraph {
    let mut fields: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut carries_path: BTreeSet<String> = BTreeSet::new();
    let mut from_the_webview: BTreeSet<String> = BTreeSet::new();

    for (_, source) in files {
        let cleaned = without_comments(source);
        for keyword in ["struct ", "enum "] {
            let mut from = 0;
            while let Some(at) = cleaned[from..].find(keyword) {
                let start = from + at;
                from = start + keyword.len();

                let rest = &cleaned[from..];
                let Some(name) = rest
                    .split(|c: char| !c.is_alphanumeric() && c != '_')
                    .next()
                    .filter(|n| !n.is_empty())
                else {
                    continue;
                };
                // **webview から来る型だけを見る。** `tauri::State` で注入される
                // `AppState` は台帳を通って engine_path に届くが、値を渡すのは
                // フロントではない。混ぜると、注入される型を持つコマンドが全部並ぶ
                let head = &cleaned[..start];
                let attributes = &head[head.rfind(['}', ';']).map(|i| i + 1).unwrap_or(0)..];
                if attributes.contains("Deserialize") {
                    from_the_webview.insert(name.to_string());
                }

                let Some(open) = rest.find('{') else { continue };
                // 宣言の頭と `{` の間に `;` があれば、それはタプル構造体か別の item
                if rest[..open].contains(';') {
                    continue;
                }
                let Some(len) = matching_brace(&rest[open..]) else {
                    continue;
                };
                let body = &rest[open..open + len];

                let entry = fields.entry(name.to_string()).or_default();
                for line in body.lines() {
                    let Some((field, ty)) = line.trim().split_once(':') else {
                        continue;
                    };
                    let field = field.trim().trim_start_matches("pub ").trim();
                    if !field.chars().all(|c| c.is_alphanumeric() || c == '_') || field.is_empty() {
                        continue;
                    }
                    if field == "path"
                        || field == "dir"
                        || field.ends_with("_path")
                        || field.ends_with("_dir")
                        || ty.contains("PathBuf")
                        || ty.contains("&Path")
                    {
                        carries_path.insert(name.to_string());
                    }
                    entry.extend(
                        ty.split(|c: char| !c.is_alphanumeric() && c != '_')
                            .filter(|t| t.starts_with(char::is_uppercase))
                            .map(str::to_string),
                    );
                }
                from += open + len;
            }
        }
    }

    // **含む型もパスを運ぶ。** `GameSettings` は `PlayerSpec` を持ち、
    // その中に `engine_path` がある。1段しか見ないと `start_game` は拾えない
    loop {
        let mut grew = false;
        for (name, referenced) in &fields {
            if carries_path.contains(name) {
                continue;
            }
            if referenced.iter().any(|r| carries_path.contains(r)) {
                carries_path.insert(name.clone());
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }

    TypeGraph {
        carries_path,
        from_the_webview,
    }
}

/// 型の名前 → その型がパスを運ぶか / webview から来るか
struct TypeGraph {
    carries_path: BTreeSet<String>,
    from_the_webview: BTreeSet<String>,
}

/// 先頭の `{` に釣り合う `}` の直後までの長さ
fn matching_brace(from: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (offset, ch) in from.char_indices() {
        match ch {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(offset + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// コマンドの引数に現れる型の名前
fn parameter_types(chunk: &str) -> BTreeSet<String> {
    let Some(start) = chunk.find("fn ") else {
        return BTreeSet::new();
    };
    let chunk = &chunk[start..];
    let (Some(open), Some(close)) = (chunk.find('('), chunk.find(')')) else {
        return BTreeSet::new();
    };
    if close < open {
        return BTreeSet::new();
    }
    chunk[open + 1..close]
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|t| t.starts_with(char::is_uppercase))
        .map(str::to_string)
        .collect()
}

/// **`STRUCT_CARRIED_PATH` の載せ忘れを拾う。**
///
/// 手で並べる一覧は、足す人が忘れた時点で静かに緩む。忘れられたコマンドは
/// `every_path_taking_command_checks_the_root` の対象にすら入らないので、
/// 関門も免除の理由も無いまま緑で通る。
///
/// 引数の型を辿り、`*_path` / `*_dir` / `PathBuf` の欄に届くものを拾って
/// 一覧と突き合わせる。**含む型も運ぶ**ものとして数える
/// （`GameSettings` → `PlayerSpec` → `engine_path`）。
#[test]
fn no_path_carrying_command_is_missing_from_the_list() {
    let files = rust_files(Path::new("src"));
    let types = type_graph(&files);
    assert!(
        types.carries_path.contains("GameSettings"),
        "型を辿れていない。`GameSettings` が `engine_path` に届いていない"
    );
    assert!(
        types.from_the_webview.contains("GameSettings")
            && !types.from_the_webview.contains("AppState"),
        "webview から来る型の判定が壊れている"
    );

    let mut missing = Vec::new();
    for (file, source) in &files {
        for (name, body) in commands(source) {
            if STRUCT_CARRIED_PATH.contains(&name.as_str()) || takes_a_path(&body) {
                continue;
            }
            let carried: Vec<String> = parameter_types(&body)
                .into_iter()
                .filter(|t| types.carries_path.contains(t) && types.from_the_webview.contains(t))
                .collect();
            if !carried.is_empty() {
                missing.push(format!("{file}: {name}（{}）", carried.join(", ")));
            }
        }
    }

    assert!(
        missing.is_empty(),
        "引数の型がパスを運んでいるのに `STRUCT_CARRIED_PATH` に無い。\
         このままだと root の検査から丸ごと外れる:\n{}",
        missing.join("\n")
    );
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

    // 関門は**存在確認より前**に置く。後ろに置くと、root 外のパスについて
    // 在るかどうかや種類の判定結果まで返してしまう。
    // 規則がコメントにしか無いと、10個目のコマンドを足す人が順序を逆にしても緑になる。
    //
    // **変数ごとに見る。** 位置だけで比べると、パスを2本受けるコマンドで
    // 「1本目の関門 → 1本目の存在確認 → 2本目の関門」という正しい並びを
    // 違反として拾うか、2本目の関門を後ろへ動かしても見逃すかのどちらかになる。
    // `validate_under_root(&app, &x)` の `x` を取り、その `x` に対する
    // 存在確認・種類の判定が関門より前に無いかを見る
    let mut wrong_order: Vec<String> = Vec::new();
    for (file, source) in &files {
        for (name, body) in commands(source) {
            for (guard_at, variable) in guarded_variables(&body) {
                for probe in [".exists()", ".is_dir()", ".is_file()", ".symlink_metadata("] {
                    let call = format!("{variable}{probe}");
                    if let Some(at) = body.find(&call) {
                        if at < guard_at {
                            wrong_order.push(format!(
                                "{file}: {name} が {call} を {variable} の関門より前に呼んでいる"
                            ));
                        }
                    }
                }
                let ensure = format!("ensure_not_exists(&{variable})");
                if let Some(at) = body.find(&ensure) {
                    if at < guard_at {
                        wrong_order.push(format!(
                            "{file}: {name} が {ensure} を {variable} の関門より前に呼んでいる"
                        ));
                    }
                }
            }
        }
    }
    assert!(
        wrong_order.is_empty(),
        "関門より前に存在や種類を見ている:\n{}",
        wrong_order.join("\n")
    );

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
        "そのコマンドだけが呼ぶべき関門を呼んでいない:\n{}",
        missing_extra.join("\n")
    );

    // 0件で緑になる形を作らない。切り出しが壊れたらここで気づく
    assert!(
        all >= 30,
        "コマンドを {all} 件しか見つけられていない。切り出しが壊れている"
    );
    // 下限は**壊れ検出**。現在値と一致させない（正当に減らしたとき、
    // 「署名の判定が壊れている」という無関係なメッセージで落ちる）
    assert!(
        path_taking.len() >= 12,
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
    // コマンド名の側を綴り間違えると `name == command` が永久に偽になり、
    // 対応表の1行が黙って無効になる（関門名の側は `missing_extra` が拾う）
    for (listed, _) in EXTRA_GUARDS {
        assert!(
            names.iter().any(|n| n == listed),
            "EXTRA_GUARDS: {listed} が無い"
        );
    }
}

/// `EXTRA_GUARDS` が要求する関門が、実在する `pub fn` か
#[test]
fn every_extra_guard_is_a_real_function() {
    let sources: String = rust_files(Path::new("src"))
        .iter()
        .map(|(_, source)| source.as_str())
        .collect::<Vec<_>>()
        .join("\n");

    for (command, guard) in EXTRA_GUARDS {
        assert!(
            sources.contains(&format!("pub fn {guard}")),
            "{command} が要求する {guard} が実在しない"
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
