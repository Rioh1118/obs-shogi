//! ソースを文字列として読む検査が共有する、括弧の対応取り。
//!
//! **手書きで括弧を数えると、毎回同じ穴が開く。** `'{'` や `br#"{"header":"#` を
//! 開き括弧として数える、`Channel<()>` の `)` を署名の終わりと読む、
//! `[&str; 3]` の `;` で item を切る、コメントの中の `mod tests {` を
//! module として数える、文字列の中の `/*` でファイルの残りを捨てる——
//! どれも実際に起きた。数える場所を1つにして、文字列・文字・コメントを読み飛ばす。
//!
//! **`no_test_counts_delimiters_by_hand` が、走査でもないファイルが
//! ついでに数え始める形を落とす。** 走査を組み立てるファイル自体は対象外
//! （そこは数えるのが仕事）なので、**手書きの数えが書けなくなるわけではない**。
//! 走査を触る人は、その doc を読んでから数えること。
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
    // **入れ子を数える。** Rust のブロックコメントは入れ子になるので、最初の `*/` で
    // 切り上げると**外側のコメントの残りがコードとして走査される**——中に
    // `#[cfg(test)]` があれば、そこから続く本番の関数が1つの item として落ちる。
    // 塊を丸ごとコメントアウトする（中に既に `/* */` がある）は普通の操作
    if rest.starts_with("/*") {
        let mut depth = 0usize;
        let mut at = 0;
        while at < rest.len() {
            if rest[at..].starts_with("/*") {
                depth += 1;
                at += 2;
                continue;
            }
            if rest[at..].starts_with("*/") {
                depth -= 1;
                at += 2;
                if depth == 0 {
                    return Some(at);
                }
                continue;
            }
            at += rest[at..]
                .chars()
                .next()
                .expect("残りがあれば1文字は取れる")
                .len_utf8();
        }
        return Some(rest.len());
    }

    // `b` / `br` の接頭辞を剥がしてから見る
    let (marker, body) = ["br", "r", "b", ""]
        .into_iter()
        .find_map(|p| rest.strip_prefix(p).map(|body| (p, body)))
        .expect("空文字列は必ず剥がせる");
    let prefix = marker.len();

    // **`br"..."` も raw。** `rest` の先頭が `r` かで見ると `br` が落ち、
    // `\` をエスケープとして食って閉じ引用符を見失う——そこから先の
    // 文字列とコードの区別が反転する。`br#"..."#` は通るので、読んで気付けない
    let is_raw = marker.contains('r');
    if is_raw && (body.starts_with('#') || body.starts_with('"')) {
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
    blank_out(source, true, false)
}

/// コメントに加えて**文字列・文字リテラルも**空白に潰す。
///
/// 括弧やキーワードを数えるだけで、中身を読まない走査に使う。
/// 残すと `const A: &str = "mod x {";` の1行が module を開いたことになる。
pub fn blank_out_noncode(source: &str) -> String {
    blank_out(source, true, true)
}

/// **文字列・文字リテラルだけ**を空白に潰す。コメントは残す。
///
/// コメントの中身が読みたい走査に使う。生文字列に doc コメントの形を
/// 書いた行（`r#"/// 説明"#`）を、本物の doc として拾うのを止める。
pub fn blank_out_strings(source: &str) -> String {
    blank_out(source, false, true)
}

fn blank_out(source: &str, comments_too: bool, literals_too: bool) -> String {
    let mut out = String::with_capacity(source.len());
    let mut at = 0;

    while at < source.len() {
        let rest = &source[at..];
        let is_comment = rest.starts_with("//") || rest.starts_with("/*");
        if let Some(len) = skip_literal_or_comment(rest) {
            let blank = if is_comment {
                comments_too
            } else {
                literals_too
            };
            if blank {
                // **行数もバイト長も保つ。** 行数は違反の `path:line` を現物と
                // 合わせるため。バイト長は、2つの写し（コメントだけ潰した側と
                // 文字列も潰した側）に**同じ添字を打つ**ため——多バイト文字を
                // 1バイトの空白に潰すと、日本語の文字列リテラルが1本あるだけで
                // 位置がずれ、切り出した範囲が別の関数を指す
                for ch in rest[..len].chars() {
                    if ch == '\n' {
                        out.push('\n');
                    } else {
                        out.push_str(&" ".repeat(ch.len_utf8()));
                    }
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

/// `#[test]` と `#[tokio::test]` のどちらか。
///
/// **属性の綴りで絞ると片方が丸ごと死角になる。** 対局の状態機械のテストは
/// ほとんどが非同期なので、`#[test]` だけを見る走査は `session.rs` を
/// 1本も読まないまま緑になる。
pub fn is_test_attribute(line: &str) -> bool {
    let line = line.trim();
    line == "#[test]" || (line.starts_with("#[tokio::test") && line.ends_with(']'))
}

/// その行の直前に続く `///` を、上から順に返す。
///
/// 返すのは `(1始まりの行番号, `///` を外した中身)`。
pub fn doc_above(lines: &[&str], at: usize) -> Vec<(usize, String)> {
    let mut block = Vec::new();
    let mut cursor = at;
    while cursor > 0 {
        let Some(text) = lines[cursor - 1].trim().strip_prefix("///") else {
            break;
        };
        block.push((cursor, text.trim().to_string()));
        cursor -= 1;
    }
    block.reverse();
    block
}

/// そのクレートの綴り（`name::`）が現れるか。
///
/// **語の境目を見る。** `contains("tauri::")` だけだと `not_tauri::MARK` に
/// 当たる。`game/` にランタイム無しで回すための身代わり（`mock_tauri` /
/// `fake_tauri`）を置いたとき、**事実と逆のメッセージで commit が止まる**。
///
/// 先頭の `::` は名前の一部ではないので境目として通す（`use ::tauri::X;`）。
pub fn mentions_crate(code: &str, name: &str) -> bool {
    let needle = format!("{name}::");
    let mut from = 0;
    while let Some(at) = code[from..].find(&needle) {
        let at = from + at;
        let before = code[..at].chars().next_back();
        if !before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
            return true;
        }
        from = at + needle.len();
    }
    false
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

/// 先頭の `<` に釣り合う `>` の直後までの長さ。**`->` と `=>` は数えない。**
///
/// `matching` で素に数えると、`fn f<F: FnMut() -> (String, u32)>(..)` の
/// `->` の `>` で深さが 0 に戻り、**ジェネリクスの途中で打ち切る**。
/// 打ち切った先の `(` を署名と読むので、生パスを受ける引数が走査から消える。
pub fn matching_angle(from: &str) -> Option<usize> {
    if !from.starts_with('<') {
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
        // 矢印は1つの記号として読み飛ばす
        if rest.starts_with("->") || rest.starts_with("=>") {
            at += 2;
            continue;
        }
        // `>>` は入れ子の閉じ2つぶん
        let ch = rest.chars().next().expect("残りがあれば1文字は取れる");
        match ch {
            '<' => depth += 1,
            '>' => {
                depth -= 1;
                if depth == 0 {
                    return Some(at + 1);
                }
            }
            _ => {}
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

/// **手書きで区切り文字を数える走査を、新しく書けなくする。**
///
/// 1つに寄せるだけでは足りない。次に走査を書く人が手で数え直せば、
/// 同じ穴（文字列の中の `{`、コメントの中の `mod {`、文字列の中の `/*`、
/// 文字列の中の `//`）がそのまま戻る。
///
/// **守るのは「走査を組み立てないファイル」だけ。** `mod scanning;` を書いた
/// ファイルは丸ごと対象外にする——そこは区切り文字を数えるのが仕事で、
/// `matching(rest, '(', ')')` のような行が必ず出るため。
///
/// **つまり「手書きの数えは書けなくなる」わけではない。** 走査を書く人は
/// `mod scanning;` を足したうえで手で数え直せる。そこは人が見るしかない。
/// この検査が止めるのは「走査でもないファイルが、ついでに区切り文字を数え始める」形。
///
/// 免除を狭く保つために、次の3つを塞いである。
///
/// - **判定は文字列も潰してから。** `let _ = "mod scanning;";` の1行や
///   コメントでの言及で免除を取られない
/// - **サブディレクトリも歩く。** `read_dir` は再帰しないので、
///   共有ヘルパの既定の置き場（`tests/scanning/` がまさにそれ）が丸ごと死角になる
/// - **形は一覧でなく述語で見る。** 一覧にすると `contains` のような形を漏らす
#[test]
fn no_test_counts_delimiters_by_hand() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let mut offenders = Vec::new();

    for path in test_sources(&dir) {
        // **ここは字句解析そのもの。** 除くのはパスで明示する——文字列や
        // コメントの綴りで自己免除すると、免除を取る側と同じ抜け道になる
        if path.parent().is_some_and(|p| p.ends_with("scanning")) {
            continue;
        }

        let source = std::fs::read_to_string(&path).unwrap_or_default();
        // **走査を組み立てているファイルは対象外。** そこは区切り文字を数えるのが
        // 仕事なので、`matching(rest, '(', ')')` のような行が必ず出る。
        // 判定は文字列も潰した側で——`let _ = "mod scanning;";` の1行で
        // 免除を取られないため
        if blank_out_noncode(&source).contains("mod scanning;") {
            continue;
        }
        // **数えている形を探すのはコメントだけ潰した側で。** 文字列まで潰すと、
        // 探している当のリテラル（`'{'`）が消えて何も見つからない
        for smell in counting_by_hand(&blank_out_comments(&source)) {
            offenders.push(format!("{}: {smell}", path.display()));
        }
    }

    assert!(
        offenders.is_empty(),
        "`tests/` で区切り文字を手書きで数えている。`scanning` を使うこと\
         （文字列・文字・コメントを読み飛ばさないと、同じ穴がまた開く）:\n{}",
        offenders.join("\n")
    );
}

/// `tests/` の `.rs` を**再帰で**集める
fn test_sources(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(test_sources(&path));
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
    found.sort();
    found
}

/// 区切り文字を手で数えている形。
///
/// **メソッド名を並べない。** 並べると `contains` / `trim_matches` / `position` /
/// `split_once` が漏れ、一覧に載っているものでも rustfmt が引数を折れば通る。
/// 見るのは**引数の形**だけ——`(` や `,` の直後が区切り文字だけのリテラルなら、
/// それが何のメソッドでも字句解析を手でやっている。
///
/// 拾える形と拾ってはいけない形は `counting_by_hand_is_caught_whatever_the_method_is`
/// に並べてある。そこに無い形が出たら、doc ではなくその表を足すこと。
///
/// 文字リテラルとの `==` 比較（`c == '{'` / `b == b'{'`）も同じ。
/// メソッド呼び出しの形を取らないので、別の腕で見る。
fn counting_by_hand(code: &str) -> Vec<String> {
    const DELIMITERS: &str = "{}()[]<>/*\"'\\";
    // **外側の引用符だけを剥がす。** `trim_matches` で両端を潰すと、
    // `'\"'`（引用符そのものを探す形）の中身まで消えて素通りする
    let is_delimiter_literal = |argument: &str| {
        let body = argument.trim_start_matches(['b', 'r', '#']);
        let Some(body) = body.strip_prefix(['\'', '"']) else {
            return false;
        };
        let Some(inner) = body.trim_end_matches('#').strip_suffix(['\'', '"']) else {
            return false;
        };
        if inner.is_empty() {
            return false;
        }
        // **エスケープで書いた区切り文字も同じ。** `'\u{7b}'` は `'{'`
        if let Some(hex) = inner.strip_prefix("\\u{").and_then(|r| r.strip_suffix('}')) {
            return u32::from_str_radix(hex, 16)
                .ok()
                .and_then(char::from_u32)
                .is_some_and(|c| DELIMITERS.contains(c));
        }
        inner.chars().all(|c| DELIMITERS.contains(c))
    };

    let mut found = Vec::new();
    let mut at = 0;

    while at < code.len() {
        let rest = &code[at..];
        if let Some(len) = skip_literal_or_comment(rest) {
            at += len;
            continue;
        }

        // **リテラルが置かれうる位置を全部見る。**
        //
        // - `(` / `,` — 引数。`splitn(2, '{')` のように2つ目に来る形がある
        // - `[` — 配列。`s.split(['{'])` は要素が1つでも配列
        // - `=` — 束縛。`const OPEN: char = '{';` で名前を付けてから使う形
        // - `==` / `!=` — 比較。`c == '{'` はメソッド呼び出しの形を取らない
        //
        // どれも**折り返しを跨ぐ**。rustfmt は長い呼び出しの引数を次の行へ折るので、
        // 直後だけを見ると、名前が分かっている呼び出しでも素通りする
        let opener = ["(", ",", "[", "==", "!=", "=>", "="]
            .into_iter()
            .find(|token| rest.starts_with(token));
        if let Some(token) = opener {
            // `=>` は腕の区切りで、リテラルは左側にある。`==` / `!=` と取り違えない
            if token != "=>" {
                let head = rest[token.len()..].trim_start();
                if let Some(len) = skip_literal_or_comment(head) {
                    let argument = &head[..len];
                    if is_delimiter_literal(argument) {
                        let name = match token {
                            "(" | "," => {
                                enclosing_call(&code[..at]).unwrap_or_else(|| "?".to_string())
                            }
                            other => other.to_string(),
                        };
                        found.push(format!("{name}({argument})"));
                    }
                }
            }
            at += token.len();
            continue;
        }

        at += rest
            .chars()
            .next()
            .expect("残りがあれば1文字は取れる")
            .len_utf8();
    }
    found
}

/// いま開いている呼び出しの名前。報告に出すだけなので、取れなければ `None`
fn enclosing_call(head: &str) -> Option<String> {
    let open = head.rfind('(').unwrap_or(head.len());
    let name: String = head[..open]
        .chars()
        .rev()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    (!name.is_empty()).then_some(name)
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

        // **入れ子のブロックコメント。** 最初の `*/` で切り上げると、外側の
        // 残りがコードとして走査される
        let source = "{ /* 外 /* 内 */ mod x { */ }";
        assert_eq!(matching(source, '{', '}'), Some(source.len()));
        assert_eq!(
            skip_literal_or_comment("/* /* */ mod x { */"),
            Some(19),
            "入れ子のブロックコメントを最初の `*/` で切り上げている"
        );

        // **`br"..."`（ハッシュ無しの raw バイト列）。** `\` はエスケープではない
        let source = "{ let p = br\"C:\\\"; let q = \"}\"; }";
        assert_eq!(
            matching(source, '{', '}'),
            Some(source.len()),
            "`br\"..\"` を普通の文字列として読み、閉じ引用符を見失っている"
        );
    }

    #[test]
    fn a_paren_scan_survives_a_unit_type_argument() {
        // **`->` の `>` でジェネリクスを切らない**
        let source = "<F: FnMut() -> (String, u32)>";
        assert_eq!(
            matching_angle(source),
            Some(source.len()),
            "`->` の `>` でジェネリクスを切っている"
        );
        let source = "<F: Fn() -> Vec<(u8, u8)>>";
        assert_eq!(matching_angle(source), Some(source.len()));

        // `Channel<()>` の `)` で署名が切れない
        let source = "(app: AppHandle, ch: Channel<()>, file_path: String)";
        let len = matching(source, '(', ')').expect("釣り合わない");
        assert_eq!(len, source.len());
        assert!(source[..len].contains("file_path"));
    }

    /// 手書きの数え方を、メソッド名によらず拾うこと。
    ///
    /// **一覧で持つと必ず漏れる。** メソッド名を並べていたときは、20通り中
    /// 17通りが素通りした——`contains` / `position` / `as_bytes()[i]` はもちろん、
    /// **一覧に載っているメソッドでも rustfmt が引数を折れば**通った。
    #[test]
    fn counting_by_hand_is_caught_whatever_the_method_is() {
        let caught = |code: &str| !counting_by_hand(code).is_empty();

        // 拾うべき形
        for code in [
            "s.find('{')",
            "s.contains('{')",
            "s.ends_with('}')",
            "s.strip_prefix(\"//\")",
            "s.split_once('(')",
            "s.splitn(2, '{')",
            "s.match_indices(\"*/\")",
            "s.trim_matches('\"')",
            "s.rfind('}')",
            "s.matches('{').count()",
            // rustfmt が引数を折った形
            "s.find(\n    '{',\n)",
            // 文字リテラルとの比較
            "if c == '{' { }",
            "if b != b'{' { }",
            // **束縛。** 名前を付けてから使う形
            "const OPEN: char = '{';",
            // **配列。** 要素が1つでも配列
            "s.split(['{'])",
            // エスケープで書いた区切り文字
            "s.find('\\u{7b}')",
        ] {
            assert!(caught(code), "手書きの数え方を拾えていない: {code}");
        }

        // 拾ってはいけない形（区切り文字ではないリテラル）
        for code in [
            "s.find(\"validate_under_root\")",
            "s.contains(\"mod scanning;\")",
            "s.split(',')",
            "if kind == 'a' { }",
            "s.starts_with(\"pub fn \")",
        ] {
            assert!(
                !caught(code),
                "区切り文字でないリテラルを手書きの数えとして拾っている: {code}"
            );
        }
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

        // **2つの写しにバイト長の差が出ないこと。** 差が出ると、片方に打った
        // 添字がもう片方で別の場所を指す（日本語の文字列リテラルは現物に多い）
        let source = "// コメント\nlet s = \"日本語の文字列\";\nfn f() {}\n";
        assert_eq!(
            blank_out_comments(source).len(),
            blank_out_noncode(source).len(),
            "潰し方でバイト長が変わっている"
        );
        assert_eq!(
            blank_out_comments(source).len(),
            source.len(),
            "潰すと元よりバイト長が縮んでいる"
        );

        // **`blank_out_strings` は向きが逆。** 生文字列の中に doc コメントの
        // 形を書いても、本物の doc として読まれないこと
        let source = "let s = r#\"/// 説明（表の E1）\"#;\n/// 本物（表の E4）\nfn f() {}\n";
        let blanked = blank_out_strings(source);
        assert!(
            !blanked.contains("E1"),
            "文字列の中の doc を残している: {blanked:?}"
        );
        assert!(
            blanked.contains("E4"),
            "本物の doc まで潰している: {blanked:?}"
        );
        assert_eq!(blanked.len(), source.len(), "バイト長が変わっている");
    }

    /// クレートの綴りを語の境目で見ていること。
    ///
    /// 部分一致にすると、`game/` に置いた身代わり（`mock_tauri`）が
    /// 「`tauri` を参照している」として commit を止める。
    #[test]
    fn a_crate_name_is_matched_at_a_word_boundary() {
        assert!(mentions_crate("fn f(app: tauri::AppHandle) {}", "tauri"));
        assert!(mentions_crate("use ::tauri::AppHandle;", "tauri"));
        assert!(mentions_crate("tauri::Emitter", "tauri"));

        assert!(!mentions_crate(
            "mod not_tauri { }\nnot_tauri::MARK;",
            "tauri"
        ));
        assert!(!mentions_crate("mock_tauri::AppHandle", "tauri"));
        assert!(!mentions_crate("let tauri = 1;", "tauri"));

        // 途中に紛れ物があっても、本物が別の場所にあれば拾う
        assert!(mentions_crate("mock_tauri::X; tauri::Y;", "tauri"));
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
