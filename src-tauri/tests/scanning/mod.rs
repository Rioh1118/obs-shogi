//! ソースを文字列として読む検査が共有する、括弧の対応取り。
//!
//! **3つの検査が同じ前提で括弧を数える。** 別々に書くと、同じ穴が3つできる——
//! `'{'` や `br#"{"header":"#` を開き括弧として数える、`Channel<()>` の `)` を
//! 署名の終わりと読む、`[&str; 3]` の `;` で item を切る。
//! 数える場所を1つにして、文字列・文字・コメントを読み飛ばす。
//!
//! **見つからないことを黙って通さない。** 走査が壊れたときに「違反0」を返すと、
//! 検査は緑のまま何も見ていない状態になる。呼び出し側は `None` を
//! 故障として扱うこと（`expect` でファイル名を出す）。

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
