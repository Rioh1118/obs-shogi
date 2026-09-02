//! Rust のコメントがバッククォートで指す識別子が、実在すること。
//!
//! `src/__tests__/docsIdentifiers.ts` の Rust 版。あちらは `docs/**` を見て、
//! こちらは Rust のコメントを見る。改名すると腐るのは両方とも同じ。
//!
//! 消えた名前を指すコメントは、**読み手を実在しない場所へ送る**。しかも
//! そのコメントが「番人は別の場所にある」のような構造の説明を含んでいると、
//! grep が空振りしたうえで「探しても無いから足そう」まで進む。
//!
//! **止められるのは綴りが1つも残っていない名前だけ。** 限界は5つ。
//!
//! 1. 別の場所に同じ綴りが在る改名（関数名 → 欄名として生存）は素通りする
//! 2. 型名・バリアント名は下線を含まないので候補にすら入らない
//! 3. 見るのは `src-tauri/src` だけ。**`src-tauri/tests` のコメントは見ていない**
//! 4. 行頭が `//` の行だけ。**行末コメントは見ていない**
//! 5. 綴りが在るかしか見ない。種類（関数か定数か欄名か）は見ていない

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

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// このリポジトリの外にある綴り。
///
/// **この検査が見るのは `src-tauri/src` だけ。** 外の識別子は当然見つからないので、
/// 免除しないと「改名し忘れ」と同じ形で落ちる。
///
/// 増やすときは、**なぜ `src-tauri/src` に無くてよいか**を1行で書けるときだけ。
/// 書けないなら、それは腐ったコメント。
/// 使われなくなった項目は `the_exempt_list_is_not_dead` が落とす。
const EXEMPT: &[&str] = &[
    // --- `std` ---
    // 確保に失敗したときの挙動を説明している
    "handle_alloc_error",
    // MSRV では使えないことを書いている
    "repeat_n",
    // --- `nom` ---
    // パースの失敗をそのまま引用できることの根拠
    "convert_error",
    // 空行の扱いを説明している
    "is_a",
    "line_sep",
    // --- `csa` ---
    // 残り入力を捨てて `Ok` を返すこと（自前で読む理由）
    "parse_csa",
    "parse_csa_file",
    "game_record",
    // 段の読み方（短い段を補わない理由）
    "board_row",
    "grid_piece",
    // --- `shogi_kifu_converter` ---
    // 手合割の盤面の畳み込み
    "normalize_initial",
    // 読めなかったことの表し方
    "recognised_nothing",
    "stopped_at",
];

/// コメントの**行頭から**の行だけを返す。`///` `//!` `//` を拾う。
///
/// ブロックコメントは追わない。`src-tauri/src` に `/*` は、コメントとしても
/// 文字列リテラルとしても1つも無いため。書かれ始めたらここを直す。
///
/// 行末コメントも拾わない（現物にバッククォート付きの識別子は0件）。
fn comment_lines(source: &str) -> Vec<(usize, &str)> {
    source
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let trimmed = line.trim_start();
            trimmed.starts_with("//").then_some((index + 1, trimmed))
        })
        .collect()
}

/// バッククォートの中の、下線を1つ以上含む綴りを拾う。
///
/// 下線を要求するのは、頭字語（`USI` / `SFEN`）と型名を除くため。
/// 型名も見られると嬉しいが、一語の型は地の文の英単語と区別できない。
fn identifiers_in(line: &str) -> Vec<String> {
    raw_identifiers_in(line)
        .into_iter()
        .filter(|name| !EXEMPT.contains(&name.as_str()))
        .collect()
}

/// `EXEMPT` を通す前の綴り。**`EXEMPT` が死んでいないかを見るのに要る**
fn raw_identifiers_in(line: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = line;

    while let Some(open) = rest.find('`') {
        let after = &rest[open + 1..];
        let Some(close) = after.find('`') else { break };
        let inline = &after[..close];
        rest = &after[close + 1..];

        let bare = inline.strip_suffix("()").unwrap_or(inline);
        if is_identifier(bare) {
            found.push(bare.to_string());
        }
    }
    found
}

fn is_identifier(text: &str) -> bool {
    if !text.contains('_') {
        return false;
    }
    let all_upper = text
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_');
    let all_lower = text
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    (all_upper || all_lower) && text.starts_with(|c: char| c.is_ascii_alphabetic())
}

/// コメントを落としたソース。**コメントどうしで名前を生き返らせない。**
fn code_only(source: &str) -> String {
    source
        .lines()
        .map(|line| match line.find("//") {
            Some(at) => &line[..at],
            None => line,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn comments_do_not_point_at_names_that_are_gone() {
    let files = rust_files(&src_dir());
    let code: String = files
        .iter()
        .map(|p| code_only(&fs::read_to_string(p).unwrap_or_default()))
        .collect::<Vec<_>>()
        .join("\n");

    let mut offenders = BTreeSet::new();
    for path in &files {
        let source = fs::read_to_string(path).unwrap_or_default();
        let relative = path.strip_prefix(src_dir()).unwrap_or(path);

        for (number, line) in comment_lines(&source) {
            for name in identifiers_in(line) {
                let word = regex_free_word_search(&code, &name);
                if !word {
                    offenders.insert(format!("{}:{}  {}", relative.display(), number, name));
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "コメントが実在しない識別子を指している。改名したらコメントも直すこと:\n{}",
        offenders.into_iter().collect::<Vec<_>>().join("\n")
    );
}

/// 語境界で探す。**部分一致では見ない。**
///
/// `includes` だと、消えた `FOO` が生きている `STOP_FOO` の一部として
/// 見つかって緑になる。接尾辞を足す改名は最も普通の形なので、そこが抜けると
/// 検査の意味が大きく減る。
fn regex_free_word_search(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let mut from = 0;

    while let Some(at) = haystack[from..].find(needle) {
        let start = from + at;
        let end = start + needle.len();
        let before_ok = start == 0 || !is_word_byte(bytes[start - 1]);
        let after_ok = end == bytes.len() || !is_word_byte(bytes[end]);
        if before_ok && after_ok {
            return true;
        }
        from = start + 1;
    }
    false
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// 走査が空振りしても違反0になる。拾えていることを別に固定する
#[test]
fn the_scanner_finds_identifiers_in_comments() {
    let found: usize = rust_files(&src_dir())
        .iter()
        .map(|p| {
            let source = fs::read_to_string(p).unwrap_or_default();
            comment_lines(&source)
                .iter()
                .map(|(_, line)| identifiers_in(line).len())
                .sum::<usize>()
        })
        .sum();

    assert!(found > 100, "コメントから {found} 件しか拾えていない");
}

/// `EXEMPT` に死んだ項目を残さない。
///
/// 使われていない除外は、検査がどれだけ緩いかの見積もりを狂わせる。
/// 足したのに1つも参照されていないなら、それは要らなかった項目
#[test]
fn the_exempt_list_is_not_dead() {
    let mentioned: BTreeSet<String> = rust_files(&src_dir())
        .iter()
        .flat_map(|p| {
            let source = fs::read_to_string(p).unwrap_or_default();
            comment_lines(&source)
                .iter()
                .flat_map(|(_, line)| raw_identifiers_in(line))
                .collect::<Vec<_>>()
        })
        .collect();

    let dead: Vec<&&str> = EXEMPT
        .iter()
        .filter(|name| !mentioned.contains(**name))
        .collect();

    assert!(
        dead.is_empty(),
        "`EXEMPT` にコメントから1度も参照されていない項目がある。落とすこと: {dead:?}"
    );
}

#[test]
fn a_word_search_does_not_match_a_longer_name() {
    assert!(regex_free_word_search(
        "const WRITE_TIMEOUT: u8",
        "WRITE_TIMEOUT"
    ));
    assert!(!regex_free_word_search(
        "const STOP_WRITE_TIMEOUT: u8",
        "WRITE_TIMEOUT"
    ));
}
