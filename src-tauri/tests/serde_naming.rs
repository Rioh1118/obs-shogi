//! 線に出る型の綴りが、TS 側の規約から外れることを止める。
//!
//! ADR-0007。IPC 境界に出る型は camelCase、値つき enum は internally tagged。
//!
//! **人の注意では続かない形の食い違いだから機械で見る。** 綴りがずれても
//! Rust も TS もコンパイルが通り、TS 側は `undefined` を読むだけになる。
//! 気付くのは、その欄を読む画面ができた後。
//!
//! `src/` を再帰で列挙する。ファイルを手書きにすると、置き場を変えただけで
//! 検査の対象から外れて緑のまま通る。
//!
//! **見ているのは属性の字面だけ。** 実際に出る JSON までは見ない
//! （そちらは境界の型ごとに `#[test]` を書く。`engine/game/types.rs` が例）。

mod scanning;

use scanning::{blank_out_comments, blank_out_noncode};

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

/// 規則の対象外。**理由なしで足さない。**
///
/// 並んでよいのは2種類だけ。
///
/// 1. **保存ファイルの形**。綴りを変えると利用者の既存ファイルが読めなくなる
/// 2. **Tauri の境界に出ない**。TS が読まないので揃える相手がいない
///
/// 「まだ直していない」は理由にならない。それは下の `BASELINE` が数える側。
const EXEMPT: [(&str, &str); 12] = [
    (
        "Fixture",
        "境界に出ない: テストの入力（`#[cfg(test)]` の中で fixture を読むだけ）",
    ),
    ("AppConfig", "保存ファイル: アプリ設定"),
    ("PresetsFile", "保存ファイル: エンジンプリセット"),
    (
        "EnginePreset",
        "同上の要素。既に camelCase だが変えられないことは同じ",
    ),
    ("AnalysisDefaults", "同上"),
    ("StudyPositionsFile", "保存ファイル: 研究局面"),
    ("StudyPosition", "同上の要素"),
    ("StudyPositionState", "同上の欄"),
    ("ScanSnapshot", "境界に出ない: 検索インデックスのキャッシュ"),
    ("FileRecord", "同上"),
    ("ScanDiff", "同上"),
    ("KifuKind", "同上"),
];

/// `rename_all = "camelCase"` が付いていない、線に出る型の数。
///
/// **減る方向にだけ動かす。** 1つ揃えたら1つ減らす。
/// 既存の移行は issue で追う。
const BASELINE: usize = 25;

/// 値つきのバリアントを持つのに internally tagged になっていない enum の数。
///
/// 同じく減る方向にだけ。タプル型のバリアント（`MateInMoves(i32)`）は
/// serde が internally tagged にできないので、`{ moves: i32 }` へ直す作業を伴う。
const UNTAGGED_ENUM_BASELINE: usize = 2;

#[derive(Debug)]
struct SerdeType {
    file: String,
    name: String,
    attrs: String,
    is_enum: bool,
    /// バリアントが値を持つ enum か。struct では常に false
    carries_data: bool,
}

fn main() {}

fn collect(dir: &Path, out: &mut Vec<SerdeType>) {
    for entry in fs::read_dir(dir).expect("src/ を読めない") {
        let path = entry.expect("エントリを読めない").path();
        if path.is_dir() {
            collect(&path, out);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let text = fs::read_to_string(&path).expect("ソースを読めない");
        let file = path
            .strip_prefix(env!("CARGO_MANIFEST_DIR"))
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        parse(&file, &text, out);
    }
}

fn parse(file: &str, text: &str, out: &mut Vec<SerdeType>) {
    // **属性の中身は読むので、コメントだけを潰した側で見る。**
    // 括弧を数える側は文字列も潰す——素で数えると `'{'` の文字リテラルや
    // `"http://..."` で深さがずれ、enum の後半が「値を持たない」と判定されて
    // ADR-0007 の検査を素通りする。どちらも行数を保つので添字は共通
    let readable = blank_out_comments(text);
    let countable = blank_out_noncode(text);
    let lines: Vec<&str> = readable.lines().collect();
    let code_lines: Vec<&str> = countable.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i].trim();
        if !(line.starts_with("#[derive")
            && (line.contains("Serialize") || line.contains("Deserialize")))
        {
            i += 1;
            continue;
        }

        // derive の次から、宣言に当たるまでの間に serde 属性が並ぶ。
        // 属性は複数行に折り返されることがあるので、宣言まで全部つなげて読む
        let mut attrs = String::new();
        let mut j = i + 1;
        let mut decl = None;
        while j < lines.len() {
            let s = lines[j].trim();
            if let Some(rest) = s
                .strip_prefix("pub enum ")
                .or_else(|| s.strip_prefix("enum "))
            {
                decl = Some((true, name_of(rest), j));
                break;
            }
            if let Some(rest) = s
                .strip_prefix("pub struct ")
                .or_else(|| s.strip_prefix("struct "))
            {
                decl = Some((false, name_of(rest), j));
                break;
            }
            attrs.push_str(s);
            attrs.push(' ');
            j += 1;
        }

        let Some((is_enum, name, decl_line)) = decl else {
            i += 1;
            continue;
        };

        out.push(SerdeType {
            file: file.to_string(),
            name,
            attrs: attrs.clone(),
            is_enum,
            carries_data: is_enum && enum_carries_data(&code_lines, decl_line),
        });
        i = j + 1;
    }
}

fn name_of(rest: &str) -> String {
    rest.chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect()
}

/// バリアントが値を持つか。宣言行から対応する閉じ括弧までを見て、
/// `Variant(` か `Variant {` の形を探す。
///
/// **中括弧の数を数える。** 行数で打ち切ると、長い enum の後半が読まれずに
/// 「値を持たない」と判定されて素通りする。
///
/// 数える前にコメントと文字列を潰してある（`parse` が `blank_out_noncode` を
/// 通す）。`split("//")` だけだと文字列の中の `//` や `{` で深さがずれ、
/// 後半のバリアントが「値を持たない」に落ちる。
fn enum_carries_data(lines: &[&str], decl_line: usize) -> bool {
    let mut depth = 0usize;
    let mut started = false;

    for line in &lines[decl_line..] {
        let code = *line;
        for c in code.chars() {
            match c {
                '{' => {
                    depth += 1;
                    started = true;
                }
                '}' => depth = depth.saturating_sub(1),
                _ => {}
            }
        }
        if started && depth == 0 {
            break;
        }
        // 宣言行そのものにバリアントは無い
        if std::ptr::eq(*line, lines[decl_line]) {
            continue;
        }
        let trimmed = code.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        // `Variant(..)` / `Variant {` を持つ行があれば値つき
        if let Some(head) = trimmed.split(&['(', '{'][..]).next() {
            let head = head.trim();
            let is_variant = !head.is_empty()
                && head.chars().next().is_some_and(|c| c.is_uppercase())
                && head.chars().all(|c| c.is_alphanumeric() || c == '_');
            if is_variant && (trimmed.contains('(') || trimmed.contains('{')) {
                return true;
            }
        }
    }
    false
}

fn all_types() -> Vec<SerdeType> {
    let mut out = Vec::new();
    collect(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src").as_path(),
        &mut out,
    );
    out
}

fn is_exempt(name: &str) -> bool {
    EXEMPT.iter().any(|(n, _)| *n == name)
}

#[test]
fn the_scanner_actually_finds_types() {
    // 0件を見て緑になる形を止める
    let types = all_types();
    assert!(
        types.len() > 50,
        "走査が型を見つけられていない: {} 件",
        types.len()
    );
    assert!(
        types.iter().any(|t| t.name == "GameSettings"),
        "既知の型を見つけられていない"
    );
    // 値つき enum を値なしと取り違えていないこと
    let evaluation_kind = types
        .iter()
        .find(|t| t.name == "EvaluationKind")
        .expect("EvaluationKind が見つからない");
    assert!(evaluation_kind.carries_data);
    let side = types.iter().find(|t| t.name == "Side").expect("Side");
    assert!(!side.carries_data);
}

#[test]
fn camel_case_violations_only_go_down() {
    let violations: BTreeSet<String> = all_types()
        .into_iter()
        .filter(|t| !is_exempt(&t.name))
        // `transparent` は中身をそのまま線に出す。**欄の名前が1つも出ない**ので、
        // `rename_all` を付ける先が無い（付けても何も起きない）。
        // 免除の一覧に入れると、newtype を1つ足すたびに一覧が伸びる
        .filter(|t| !t.attrs.contains("transparent"))
        .filter(|t| !t.attrs.contains(r#"rename_all = "camelCase""#))
        .map(|t| format!("{}::{}", t.file, t.name))
        .collect();

    assert!(
        violations.len() <= BASELINE,
        "ADR-0007 の違反が増えた（{} → {}）。\n\
         新しく線に出す型には `#[serde(rename_all = \"camelCase\")]` を付けること。\n\
         保存ファイルの形か、境界に出ないなら EXEMPT に理由と一緒に。\n\
         いまの違反:\n{}",
        BASELINE,
        violations.len(),
        violations.iter().cloned().collect::<Vec<_>>().join("\n")
    );

    assert_eq!(
        violations.len(),
        BASELINE,
        "違反が {} 件まで減った。BASELINE を {} に下げること",
        violations.len(),
        violations.len()
    );
}

#[test]
fn enum_field_renames_are_never_forgotten_when_tagged() {
    // ラチェットではなく、0 でなければ落ちる規則。
    // `tag` を付けたのに `rename_all_fields` を忘れると、バリアントの中だけが
    // snake_case で出る。実際にそれを踏んだ（→ ADR-0007 の文脈）
    let missing: Vec<String> = all_types()
        .into_iter()
        .filter(|t| t.attrs.contains("tag = "))
        .filter(|t| !t.attrs.contains(r#"rename_all_fields = "camelCase""#))
        .map(|t| format!("{}::{}", t.file, t.name))
        .collect();

    assert!(
        missing.is_empty(),
        "`tag` を付けたら `rename_all_fields = \"camelCase\"` も要る。\n\
         `rename_all` はバリアント名にしか効かない:\n{}",
        missing.join("\n")
    );
}

#[test]
fn untagged_data_enums_only_go_down() {
    let untagged: BTreeSet<String> = all_types()
        .into_iter()
        .filter(|t| t.is_enum && t.carries_data)
        .filter(|t| !is_exempt(&t.name))
        .filter(|t| !t.attrs.contains("tag = "))
        .map(|t| format!("{}::{}", t.file, t.name))
        .collect();

    assert!(
        untagged.len() <= UNTAGGED_ENUM_BASELINE,
        "internally tagged でない値つき enum が増えた（{} → {}）。\n\
         TS 側が判別可能ユニオンにできない:\n{}",
        UNTAGGED_ENUM_BASELINE,
        untagged.len(),
        untagged.iter().cloned().collect::<Vec<_>>().join("\n")
    );

    assert_eq!(
        untagged.len(),
        UNTAGGED_ENUM_BASELINE,
        "{} 件まで減った。UNTAGGED_ENUM_BASELINE を下げること",
        untagged.len()
    );
}
