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
//! 3. **違反を探すのは `src-tauri/src` のコメントだけ**（綴りが在るかは
//!    `src-tauri/tests` も含めて探す）。`tests/` のコメントの改名し忘れは見ていない
//! 4. 行頭が `//` の行だけ。**行末コメントは見ていない**
//! 5. 綴りが在るかしか見ない。種類（関数か定数か欄名か）は見ていない

use std::collections::BTreeSet;
mod scanning;

use scanning::{blank_out_comments, doc_above, is_test_attribute};

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

fn tests_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests")
}

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

/// このリポジトリの外にある綴り。
///
/// **綴りを探すのは `src-tauri/src` と `src-tauri/tests` の両方。** どちらにも無い、
/// リポジトリの外の名前だけをここに置く。免除しないと「改名し忘れ」と同じ形で落ちる。
///
/// ラチェットのテスト名を `src/` の doc から指すのは正しい参照なので、免除は要らない。
///
/// 増やすときは、**なぜこの2つのどちらにも無くてよいか**を1行で書けるときだけ。
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
/// ブロックコメントは追わない。`src-tauri/src` に**ブロックコメントは1つも無い**
/// （`/*` の綴りは文字列リテラルと行コメントの中にだけ在る）。書かれ始めたらここを直す。
///
/// 行末コメントも拾わない（現物にバッククォート付きの識別子は0件）。
fn comment_lines(source: &str) -> Vec<(usize, &str)> {
    source
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let trimmed = line.trim_start();
            is_comment_line(trimmed).then_some((index + 1, trimmed))
        })
        .collect()
}

/// 行全体がコメントか。
///
/// **`//` を手で探す代わりに、潰した結果と見比べる。** 文字列の中の `//` を
/// コメントの始まりと読むと、その行が丸ごとコメント扱いになる。
fn is_comment_line(trimmed: &str) -> bool {
    !trimmed.is_empty() && blank_out_comments(trimmed).trim().is_empty()
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
///
/// `//` を手で探さない——文字列の中の `//`（URL）で行を切ると、
/// そこから右にある本物の綴りが「実在しない」に化ける。
fn code_only(source: &str) -> String {
    blank_out_comments(source)
}

/// コメント行の判定が、文字列の中の `//` に反応しないこと。
///
/// **現物だけを食わせていると差が出ない**（`src/` に該当する形がまだ無い）。
/// 反応すると、その行が丸ごとコメント扱いになって本物の綴りが消える。
#[test]
fn a_url_in_a_string_is_not_a_comment() {
    assert!(is_comment_line("// 説明"));
    assert!(is_comment_line("/* 説明 */"));
    assert!(!is_comment_line("let u = \"https://example.org\";"));
    assert!(!is_comment_line("let s = \"a\"; // 後ろのコメント"));
}

/// テストの doc ブロックに、要約が2つ並んでいないこと。
///
/// **関数を挿入すると、既存の doc がそこで引き剥がされる。** 新しい要約を
/// 前の doc の途中へ落とすと、`cargo doc` では2つの文が連結されて読める形になり、
/// **前の関数の説明が後の関数のものとして残る**（`pub` から `///` が消えることもある）。
///
/// 要約と見るのは「**「〜こと。」で終わる**行」。それが**2本以上あったら**
/// 引き剥がしとする。
///
/// **句点だけで見ると本文を巻き込む。** 「捨てないと、〜。」のように条件から
/// 始まる段落が句点で終わるのは普通で、実測で7件が偽陽性になった。この repo の
/// テストの doc は「何を固定しているか」を「〜こと。」で言う形に揃っているので、
/// そこで区別する。**テストの直前に絞る**のも同じ理由で、`pub fn` の doc は
/// この形に揃っていない。
///
/// **空行の直後という条件は付けない。** 挿入された要約は前の doc の本文の
/// 途中に落ちるので、空行を挟むとは限らない。
///
/// **拾えるのはここまで。**
///
/// - **元から要約行を持つブロック**に、2本目が落ちた形だけ。要約行を1本も
///   持たないブロックへの挿入は、落ちてきた要約がそのブロックで唯一の
///   「〜こと。」になるので通る。「1行目以外に現れたら」まで広げると、
///   要約が2行に折り返している doc と、本文の段落が「〜すること。」で終わる
///   doc を巻き込む（実測で2件）
/// - **テストの直前だけ。** 素の `fn` / `struct` / `const` への挿入は見ていない。
///   そちらの doc は「〜こと。」で終わる形に揃っていないので、同じ鍵が効かない
#[test]
fn no_doc_block_has_two_summaries() {
    let mut offenders = Vec::new();

    for path in rust_files(&src_dir())
        .into_iter()
        .chain(rust_files(&tests_dir()))
    {
        let source = fs::read_to_string(&path).unwrap_or_default();
        let relative = path.strip_prefix(src_dir()).unwrap_or(&path).to_path_buf();
        let lines: Vec<&str> = source.lines().collect();

        for (index, line) in lines.iter().enumerate() {
            if !is_test_attribute(line) {
                continue;
            }
            let summaries = doc_above(&lines, index)
                .into_iter()
                .filter(|(_, text)| text.ends_with("こと。"));
            for (number, text) in summaries.skip(1) {
                offenders.push(format!("{}:{}  {}", relative.display(), number, text));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "テストの doc ブロックに要約が2つある。関数を挿入したとき、\
         新しい要約を前の doc の途中へ落としていないか見ること:\n{}",
        offenders.join("\n")
    );
}

/// doc ブロックの直後が `use` になっていないこと。
///
/// **`use` を足す位置で doc が剥がれる。** 既存の doc と関数の間へ入れると、
/// `cargo doc` ではその関数が**説明の無い `pub fn`** になり、doc は
/// どの item にも着かない `use` の飾りとして残る。剥がれたまま読んだ人は
/// 「なぜこの関数が要るのか」に辿り着けない。
///
/// **コンパイラは何も言わない。** `use` は item なので `///` を付けるのは合法で、
/// doc はそこに着いてしまう。剥がれ方は他にもあるが、この形は綴りで一意に拾える。
/// 関数の挿入で剥がれる形は `no_doc_block_has_two_summaries` が別の鍵で見る。
///
/// **次の非空行を見る。属性も跨ぐ。** `use` を足す人は前後に空行を入れるほうが
/// 自然で、`#[allow(...)]` を挟む形も正しい並び（doc → 属性 → item）なので、
/// 直後の1行だけを見ると**いちばん起きやすい置き方が死角**になる。
#[test]
fn no_doc_block_is_followed_by_a_use() {
    let mut offenders = Vec::new();

    for path in rust_files(&src_dir())
        .into_iter()
        .chain(rust_files(&tests_dir()))
    {
        let source = fs::read_to_string(&path).unwrap_or_default();
        let relative = path.strip_prefix(src_dir()).unwrap_or(&path).to_path_buf();
        let lines: Vec<&str> = source.lines().collect();

        for (index, line) in lines.iter().enumerate() {
            if !line.trim_start().starts_with("///") {
                continue;
            }
            // 空行・doc の続き・属性を跨いで、**最初に来る item の行**を探す。
            // 属性で止めると、`/// …` `#[allow(...)]` `use …;` の並び
            // （Rust として正しい並び）が素通りする
            let Some((at, next)) = lines
                .iter()
                .enumerate()
                .skip(index + 1)
                .map(|(at, line)| (at, line.trim_start()))
                .find(|(_, line)| {
                    !line.is_empty() && !line.starts_with("///") && !line.starts_with("#[")
                })
            else {
                continue;
            };
            if next.starts_with("use ") || next.starts_with("pub use ") {
                offenders.push(format!("{}:{}  {next}", relative.display(), at + 1));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "doc ブロックの直後に `use` がある。剥がれた doc は `cargo doc` で\
         どの item にも着かない:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn comments_do_not_point_at_names_that_are_gone() {
    let files = rust_files(&src_dir());
    // **`tests/` も干し草に入れる。** `src/` の doc は、その関係を式で固定している
    // ラチェットのテスト名を指すことがある（`the_watchdogs_are_ordered` の形）。
    // 入れないと、正しい参照が「実在しない識別子」として落ちる。
    // **違反を探すのは `src/` の中だけ**——テストのコメントは別の検査が見る
    let mut haystack = files.clone();
    haystack.extend(rust_files(&tests_dir()));
    let code: String = haystack
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
