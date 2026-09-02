//! ソースを文字列として読む検査が共有する、括弧の対応取り。
//!
//! **手書きで括弧を数えると、毎回同じ穴が開く。** `'{'` や `br#"{"header":"#` を
//! 開き括弧として数える、`Channel<()>` の `)` を署名の終わりと読む、
//! `[&str; 3]` の `;` で item を切る、コメントの中の `mod tests {` を
//! module として数える、文字列の中の `/*` でファイルの残りを捨てる——
//! どれも実際に起きた。数える場所を1つにして、文字列・文字・コメントを読み飛ばす。
//!
//! **書けなくするところまでやる。** 1つに寄せても、次に走査を書く人が
//! 手で数え直せば同じ穴が戻る。`no_test_counts_delimiters_by_hand` が
//! `tests/` の中の手書きの数えを落とす。
//!
//! **見つからないことを黙って通さない。** 走査が壊れたときに「違反0」を返すと、
//! 検査は緑のまま何も見ていない状態になる。呼び出し側は `None` を
//! 故障として扱うこと（`expect` でファイル名を出す）。
//!
//! **`dead_code` を許す。** 結合テストは1ファイル1クレートで、この module は
//! それぞれに別々にコンパイルされる。どのクレートも使うのは一部だけなので、
//! 許さないと「使っていないほうのクレート」でビルドが落ちる。
#![allow(dead_code)]

/// 文字列・文字・コメントの先頭なら、その長さ（バイト）。
///
/// 中の括弧を数えないために要る。`'{'` は1文字の文字リテラル、
/// `br#"{"header":"#` は raw バイト列で、どちらも `{` を含む。
pub fn skip_literal_or_comment(rest: &str) -> Option<usize> {
    if let Some(body) = rest.strip_prefix("//") {
        let len = body.find('\n').map_or(body.len(), |at| at + 1);
        return Some(2 + len);
    }
    if let Some(body) = rest.strip_prefix("/*") {
        let len = body.find("*/").map_or(body.len(), |at| at + 2);
        return Some(2 + len);
    }

    // `b` / `br` の接頭辞を剥がしてから見る
    let (prefix, body) = ["br", "r", "b", ""]
        .into_iter()
        .find_map(|p| rest.strip_prefix(p).map(|body| (p.len(), body)))
        .expect("空文字列は必ず剥がせる");

    if body.starts_with('#') || (prefix > 0 && body.starts_with('"') && rest.starts_with('r')) {
        return raw_string(body).map(|len| prefix + len);
    }
    if let Some(inner) = body.strip_prefix('"') {
        return quoted(inner, '"').map(|len| prefix + 1 + len);
    }
    // **ライフタイムと文字リテラルを分ける。** `'a` は読み飛ばす対象ではない
    if let Some(inner) = body.strip_prefix('\'') {
        return char_literal(inner).map(|len| prefix + 1 + len);
    }
    None
}

/// `#` の数を数えてから閉じる `"#...` を探す
fn raw_string(body: &str) -> Option<usize> {
    let hashes = body.chars().take_while(|c| *c == '#').count();
    let inner = body[hashes..].strip_prefix('"')?;
    let closing = format!("\"{}", "#".repeat(hashes));
    let at = inner.find(&closing)?;
    Some(hashes + 1 + at + closing.len())
}

/// 閉じ引用符まで。`\` の直後の1文字は数えない
fn quoted(inner: &str, quote: char) -> Option<usize> {
    let mut escaped = false;
    for (at, ch) in inner.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' => escaped = true,
            c if c == quote => return Some(at + c.len_utf8()),
            _ => {}
        }
    }
    None
}

/// `'x'` なら長さ。`'a`（ライフタイム）なら `None`
fn char_literal(inner: &str) -> Option<usize> {
    if inner.starts_with('\\') {
        return quoted(inner, '\'');
    }
    let mut chars = inner.chars();
    let first = chars.next()?;
    if chars.next() == Some('\'') {
        return Some(first.len_utf8() + 1);
    }
    None
}

/// コメントを空白に潰す。**文字列は残し、行数も保つ。**
///
/// `//` の中に `#[cfg(test)]` や `mod tests {` を書いた行が、走査に item や
/// module として拾われるのを止める。文字列を消さないのは、`root_guard` が
/// 引数名を、`serde_naming` が属性の中身を見るため。
pub fn blank_out_comments(source: &str) -> String {
    blank_out(source, false)
}

/// コメントに加えて**文字列・文字リテラルも**空白に潰す。
///
/// 括弧やキーワードを数えるだけで、中身を読まない走査に使う。
/// 残すと `const A: &str = "mod x {";` の1行が module を開いたことになる。
pub fn blank_out_noncode(source: &str) -> String {
    blank_out(source, true)
}

fn blank_out(source: &str, literals_too: bool) -> String {
    let mut out = String::with_capacity(source.len());
    let mut at = 0;

    while at < source.len() {
        let rest = &source[at..];
        let is_comment = rest.starts_with("//") || rest.starts_with("/*");
        if let Some(len) = skip_literal_or_comment(rest) {
            if is_comment || literals_too {
                // 行数を保つ。潰すと違反の `path:line` が現物とずれる
                for ch in rest[..len].chars() {
                    out.push(if ch == '\n' { '\n' } else { ' ' });
                }
            } else {
                out.push_str(&rest[..len]);
            }
            at += len;
            continue;
        }
        let ch = rest.chars().next().expect("残りがあれば1文字は取れる");
        out.push(ch);
        at += ch.len_utf8();
    }
    out
}

/// コードの中の `needle` の位置。**文字列とコメントの中は数えない。**
///
/// `find` を素で使うと、doc コメントに `#[cfg(test)]` と書いた行から
/// 走査が始まり、その直後の**本番の item が丸ごと落ちる**。
pub fn find_in_code(source: &str, needle: &str) -> Option<usize> {
    let mut at = 0;
    while at < source.len() {
        let rest = &source[at..];
        if let Some(len) = skip_literal_or_comment(rest) {
            at += len;
            continue;
        }
        if rest.starts_with(needle) {
            return Some(at);
        }
        at += rest
            .chars()
            .next()
            .expect("残りがあれば1文字は取れる")
            .len_utf8();
    }
    None
}

/// 先頭の `open` に釣り合う `close` の直後までの長さ。
///
/// 先頭が `open` でない、または釣り合わないなら `None`。
pub fn matching(from: &str, open: char, close: char) -> Option<usize> {
    if !from.starts_with(open) {
        return None;
    }
    let mut depth = 0usize;
    let mut at = 0;

    while at < from.len() {
        let rest = &from[at..];
        if let Some(skip) = skip_literal_or_comment(rest) {
            at += skip;
            continue;
        }
        let ch = rest.chars().next().expect("残りがあれば1文字は取れる");
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                return Some(at + ch.len_utf8());
            }
        }
        at += ch.len_utf8();
    }
    None
}

/// 属性から始まる item 1つぶんの長さ。
///
/// **`;` は角括弧と丸括弧の外でだけ数える。** `const S: [&str; 3] = [..];` の
/// `;` を item の終わりと読むと、そこから後ろがテストコードのまま「本番」として残る。
pub fn item_end(after: &str) -> Option<usize> {
    let mut depth = 0usize;
    let mut at = 0;

    while at < after.len() {
        let rest = &after[at..];
        if let Some(skip) = skip_literal_or_comment(rest) {
            at += skip;
            continue;
        }
        let ch = rest.chars().next().expect("残りがあれば1文字は取れる");
        match ch {
            '[' | '(' => depth += 1,
            ']' | ')' => depth = depth.saturating_sub(1),
            ';' if depth == 0 => return Some(at + 1),
            '{' if depth == 0 => {
                let end = at + matching(rest, '{', '}')?;
                // `use a::{b};` の `;` も食う。`mod tests { .. }` には続かない
                let gap = after[end..].len() - after[end..].trim_start().len();
                return Some(if after[end + gap..].starts_with(';') {
                    end + gap + 1
                } else {
                    end
                });
            }
            _ => {}
        }
        at += ch.len_utf8();
    }
    None
}

/// **手書きで括弧を数える走査を、新しく書けなくする。**
///
/// 1つに寄せるだけでは足りない。次に走査を書く人が手で数え直せば、
/// 同じ穴（文字列の中の `{`、コメントの中の `mod {`、文字列の中の `/*`）が
/// そのまま戻る。
///
/// `tests/` の中で区切り文字を数えている形を探し、この module を使っていない
/// ファイルを落とす。**免除を置かない**——数えたいなら `scanning` に足すこと。
#[test]
fn no_test_counts_delimiters_by_hand() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let mut offenders = Vec::new();

    // 区切りを数えている形。`scanning` の中身は当然当たるので、そこは見ない
    let smells = [
        "matches('{')",
        "matches('}')",
        "find(')')",
        "find('}')",
        "split(\"//\")",
        "starts_with(b\"/*\")",
    ];

    for entry in std::fs::read_dir(&dir).expect("tests を読めない").flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "rs") {
            let source = std::fs::read_to_string(&path).unwrap_or_default();
            let uses_scanning = source.contains("mod scanning;");
            for smell in smells {
                if source.contains(smell) && !uses_scanning {
                    offenders.push(format!("{}: {smell}", path.display()));
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "`tests/` で区切り文字を手書きで数えている。`scanning` を使うこと\
         （文字列・文字・コメントを読み飛ばさないと、同じ穴がまた開く）:\n{}",
        offenders.join("\n")
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn brackets_inside_literals_are_not_counted() {
        // 文字リテラルの `{`（`types.rs` に実在する形）
        let source = "{ .split([' ', '{', ',']) }";
        assert_eq!(matching(source, '{', '}'), Some(source.len()));

        // raw バイト列の `{`（`kifu_reader.rs` に実在する形）
        let source = "{ br#\"{\"header\":\"# }";
        assert_eq!(matching(source, '{', '}'), Some(source.len()));

        // ふつうの文字列とエスケープ
        let source = "{ \"a{b\\\"c\" }";
        assert_eq!(matching(source, '{', '}'), Some(source.len()));

        // 行コメントとブロックコメント
        let source = "{ // {\n /* { */ }";
        assert_eq!(matching(source, '{', '}'), Some(source.len()));

        // ライフタイムを文字リテラルと読まない
        let source = "{ &'static str }";
        assert_eq!(matching(source, '{', '}'), Some(source.len()));
    }

    #[test]
    fn a_paren_scan_survives_a_unit_type_argument() {
        // `Channel<()>` の `)` で署名が切れない
        let source = "(app: AppHandle, ch: Channel<()>, file_path: String)";
        let len = matching(source, '(', ')').expect("釣り合わない");
        assert_eq!(len, source.len());
        assert!(source[..len].contains("file_path"));
    }

    #[test]
    fn comments_do_not_look_like_code() {
        // doc コメントの中の `#[cfg(test)]`。素の `find` はここから走ってしまう
        let source = "/// `#[cfg(test)] mod tests` からは見られない\npub const X: u8 = 1;\n";
        assert_eq!(find_in_code(source, "#[cfg(test)]"), None);

        // 文字列の中の `/*`。素の走査はここから残りを捨てる
        let source = "const A: &str = \"パターンは /* を含める\";\npub fn real() {}\n";
        let blanked = blank_out_comments(source);
        assert!(
            blanked.contains("pub fn real"),
            "文字列の中の `/*` で残りを捨てている: {blanked:?}"
        );
        assert_eq!(
            blanked.lines().count(),
            source.lines().count(),
            "行数が変わっている"
        );

        // コメントは空白になる。中の `mod {` は module として数えられない
        let blanked = blank_out_comments("// mod tests {\nuse a::b;\n");
        assert!(
            !blanked.contains("mod"),
            "コメントが残っている: {blanked:?}"
        );
        assert!(blanked.contains("use a::b;"), "コードまで潰している");

        // 文字列は残す
        let blanked = blank_out_comments("let s = \"keep me\"; // drop me\n");
        assert!(blanked.contains("keep me"));
        assert!(!blanked.contains("drop me"));
    }

    #[test]
    fn an_item_ends_at_the_semicolon_outside_brackets() {
        // 塊を持たない item
        assert_eq!(item_end("const A: u8 = 1;\nrest"), Some(16));
        // 配列の型の中の `;` で切らない
        let source = "const S: [&str; 3] = [\"a\", \"b\", \"c\"];\nrest";
        let end = item_end(source).expect("終わりが見つからない");
        assert!(source[..end].ends_with("];"), "{:?}", &source[..end]);
        // 塊
        let source = "mod tests {\n fn t() { }\n}\nrest";
        let end = item_end(source).expect("終わりが見つからない");
        assert!(source[..end].ends_with('}'), "{:?}", &source[..end]);
        // 波括弧を持つ `use` は `;` まで
        assert_eq!(item_end("use a::{b, c};\nrest"), Some(14));
    }
}
