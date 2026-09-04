//! 索引キャッシュの書き側の門番と、**それを名乗るテスト**を突き合わせる。
//!
//! `search/cache/index_cache.rs` の `mod tests` の直上に綴りの規約がある——
//! 書く側だけを見るなら `_not_written`、読む側だけなら `_refused`、
//! 両方なら `_neither_written_nor_read`。次に門番を足す人はその綴りで
//! 「どの門番に留めがあるか」を数える。
//!
//! **綴りは主語で `is` / `are` が入れ替わり、同義語も増える。**
//! 本数を doc に書くと、引き方の違いだけで合わなくなる。だからここが数える。
//!
//! 見るのは5つ。
//!
//! 1. 規約の外の綴りとして**知られているもの**で、テストが名乗っていないか
//! 2. `encode_all` が `Err` を作る数と、`refusing to write: ` で始まる文言の数が合うか
//! 3. その文言の**固定部分**が、`contains` で当てても恒真にならない長さか
//! 4. 文言それぞれに、書く側を名乗るテストが**その最長の固定部分**を見ているか
//! 5. ヘッダの検査が、構造の門番の綴りを名乗っていないか
//!
//! ## ここが見ないもの
//!
//! **`decode_all` の側は数えない。** あちらの `return Err` は構造の門番だけでなく
//! ヘッダの検査（版 / magic / root hash / 長さ / `file_id`）も含み、
//! 文言と門番が1対1にならない。
//!
//! **同じ文言を読み書き両側で使う門番は、片側の assert を消しても落ちない。**
//! `_neither_written_nor_read` のテストは本体に読む側の assert も持ち、
//! そこに同じ句があると照合が当たってしまう。**それは人が見ること。**
//!
//! **族の判別はどれも綴りに頼っている。** 出口は `Err` を作る構文の綴り、
//! ヘッダの検査は `MAGIC` / `header_for` などの綴り、規約の外の綴りは既知の3語。
//! **綴りを変える正当な変更（`?` 形への書き換え、ヘルパへの切り出し）が入ると、
//! そのたびに同じ形の穴が開く。** ここが見ているのは
//! **`ERR_FORMS` のどれかで返す書き側の門番**であって、書き側の門番すべてではない。
//!
//! **規約の外の綴りは既知の3語でしか見ない。** `_rejected` / `_denied` / `_not_read` 以外の
//! 同義語（`_is_declined` など）は素通りする。見つけたら `OUTSIDE` に足すこと。
//!
//! **文言の固定部分が短いと恒真になる。** `bucket {b} ...` の `bucket` は
//! テストの題材にも出るので、`contains` が当たっても assert を見た証拠にならない。
//! だから [`MIN_PHRASE`] より短い固定部分しか持たない門番は**素通りさせずに落とす。**

use std::fs;
use std::path::PathBuf;

mod roots;
mod scanning;
use scanning::{
    blank_out_comments, blank_out_noncode, find_in_code, item_end, skip_literal_or_comment,
};

/// 門番の文言に要る固定部分の最小の長さ（バイト）。
///
/// **短いと `contains` が題材に当たって恒真になる。** `bucket` や `file` は
/// 書き側テストの題材そのもの（`buckets[..]` / `file_id: 1`）なので、
/// 当たっても assert を見た証拠にならない。1語では足りず、句の長さが要る。
const MIN_PHRASE: usize = 10;

/// `refusing to write: ` の前に付く引用符まで含めた目印。
const MARK: &str = "\"refusing to write: ";

/// `encode_all` が `Err` を作る構文。
///
/// **綴りで数えている。** ここに無い形（`Err` を別の関数で組んで `?` で返す等）は
/// 出口として数えられない。いま `encode_all` にあるのは `return Err` だけで、
/// 残りは「その形へ書き換えたときに黙って穴が開かない」ための先回り。
const ERR_FORMS: [&str; 4] = ["return Err", "ok_or_else(", "ok_or(", ".map_err("];

fn index_cache_src() -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/search/cache/index_cache.rs");
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()))
}

/// `fn <名前>` を**行頭一致で**集める。
///
/// コメントも文字列も潰した写しから読む（`blank_out_noncode`）——
/// `///` や `/* */` の中の `fn foo()` と、複数行の文字列リテラルの中で
/// `fn ` から始まる行を、名前として拾わないため。
///
/// 行頭一致にしているので、**修飾子付きの宣言（`pub fn` / `async fn`）は拾わない。**
/// 索引キャッシュで規約の綴りを名乗る item は全部素の `fn` なのでこれで足りる。
/// `body_of` は `find_in_code` の部分一致なので拾う —— **非対称。**
fn fn_names(src: &str) -> Vec<String> {
    blank_out_noncode(src)
        .lines()
        .filter_map(|l| {
            let rest = l.trim().strip_prefix("fn ")?;
            let name: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            (!name.is_empty()).then_some(name)
        })
        .collect()
}

/// `fn <name>` から item の終わりまでを、**コメントを潰した写し**で返す。
///
/// 位置決めは `find_in_code`。素の `find` だと doc コメントに書いた綴りから
/// 走査が始まり、その先の item を丸ごと取り違える（`scanning` の doc が名指しする形）。
///
/// **返す実体からコメントを落とす。** 残すと、テストの直上に句を日本語で
/// 引いただけで照合が当たり、`assert!(..)` を弱めても緑になる。
/// 2つの写しはバイト長が同じなので、添字はそのまま使える（`scanning` のテストが固定）。
fn body_of(src: &str, name: &str) -> String {
    let head = format!("fn {name}");
    let Some(i) = find_in_code(src, &head) else {
        panic!("`{head}` が無い");
    };
    let len = item_end(&src[i..]).unwrap_or(src.len() - i);
    blank_out_comments(src)[i..i + len].to_owned()
}

/// 書式指定を外した固定部分のうち、**最長のもの**。
///
/// `bucket {b} is not sorted` なら `is not sorted`。
/// 最初の `{` で切ると `bucket` になり、題材にも当たって検査が恒真になる。
///
/// `\` で行を継いだ文言は、継続の直後の字下げごと詰める（Rust の意味論と同じ）。
fn longest_fixed_part(literal: &str) -> String {
    let joined = fold_escapes(&join_line_continuations(literal));
    let mut best = String::new();
    for (i, seg) in joined.split('{').enumerate() {
        let fixed = if i == 0 {
            seg
        } else {
            seg.split_once('}').map(|(_, tail)| tail).unwrap_or("")
        };
        let fixed = fixed.trim();
        if fixed.len() > best.len() {
            best = fixed.to_owned();
        }
    }
    unfold_escapes(&best)
}

/// 書式の `{{` / `}}` と、エスケープした `"` を1文字に畳む。
///
/// **畳んだ `{` を書式指定と読ませない。** 畳まずに割ると
/// `{{node}}` が空セグメントと `}` に割れ、句の先頭に `}` が残る。
/// 番兵は Rust の識別子にも文言にも出ない制御文字を使う。
fn fold_escapes(s: &str) -> String {
    s.replace("{{", &OPEN.to_string())
        .replace("}}", &CLOSE.to_string())
        .replace("\\\"", &QUOTE.to_string())
}

/// 畳んだ `{{` / `}}` / `\"` の番兵。Rust の識別子にも文言にも出ない制御文字。
const OPEN: char = '\u{1}';
const CLOSE: char = '\u{2}';
const QUOTE: char = '\u{3}';

/// 番兵を**ソースの綴りへ**戻す。**割り終わってから**呼ぶ。
///
/// 波括弧は `{` へ、引用符は `\"` へ。**向きが違う。**
/// 門番の `{{` は実行時に `{` になり、テストの assert もソースに `{` と書く。
/// 引用符は逆で、実行時の `"` をテストのソースは `\"` と書く。
/// 照合先は生のソースなので、綴りの側へ戻す。
fn unfold_escapes(s: &str) -> String {
    s.replace(OPEN, "{")
        .replace(CLOSE, "}")
        .replace(QUOTE, "\\\"")
}

/// `\` + 改行 + 字下げ を詰める。
fn join_line_continuations(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(at) = rest.find('\\') {
        out.push_str(&rest[..at]);
        let tail = &rest[at + 1..];
        match tail.strip_prefix('\n') {
            Some(next) => rest = next.trim_start(),
            None => {
                out.push('\\');
                rest = tail;
            }
        }
    }
    out.push_str(rest);
    out
}

/// `encode_all` の本体にある `refusing to write:` の文言を、**固定部分の最長**で返す。
fn refusal_phrases(encode_all_body: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = encode_all_body;
    // **接頭辞を踏まない門番は1文字も見えない。** `Err` を作る構文の数と
    // 目印の数が合わなければ、綴りの違う門番が増えている
    let exits: usize = ERR_FORMS
        .iter()
        .map(|f| count_in_code(encode_all_body, f))
        .sum();
    while let Some(at) = rest.find(MARK) {
        let from_quote = &rest[at..];
        let len = skip_literal_or_comment(from_quote)
            .unwrap_or_else(|| panic!("文字列リテラルとして読めない: {from_quote:.40}"));
        let literal = &from_quote[1..len - 1];
        // `refusing to write: ` は全部の門番に共通なので固定部分に数えない
        let body = literal
            .strip_prefix("refusing to write: ")
            .unwrap_or(literal);
        found.push(longest_fixed_part(body));
        rest = &from_quote[len..];
    }
    assert_eq!(
        found.len(),
        exits,
        "`encode_all` が `Err` を作るのが {exits} 箇所に対し、\
         `refusing to write: ` で始まる文言は {}。\
         文言はこの接頭辞で始めること。数え方は `ERR_FORMS`",
        found.len()
    );
    found
}

/// コードの中に `needle` が出る回数。文字列とコメントの中は数えない。
fn count_in_code(src: &str, needle: &str) -> usize {
    let mut n = 0;
    let mut at = 0;
    while let Some(i) = find_in_code(&src[at..], needle) {
        n += 1;
        at += i + needle.len();
    }
    n
}

/// **規約の外の綴りで名乗っているテストが無いこと。**
///
/// `rejected` と `refused` のように同じ意味で綴りが割れると、
/// 規約の3つで数えたときに集合の外へ落ちる。
#[test]
fn no_guard_test_uses_a_spelling_outside_the_convention() {
    const OUTSIDE: [&str; 3] = ["_rejected", "_denied", "_not_read"];

    let src = index_cache_src();
    let offenders: Vec<String> = fn_names(&src)
        .into_iter()
        .filter(|n| OUTSIDE.iter().any(|w| n.ends_with(w)))
        .collect();

    assert!(
        offenders.is_empty(),
        "規約の外の綴りで名乗っている。`_not_written` / `_refused` / \
         `_neither_written_nor_read` のどれかにすること:\n{}",
        offenders.join("\n")
    );
}

/// **`encode_all` が断る文言それぞれに、書く側を名乗るテストがあること。**
///
/// 門番を足したのにテストを足さない形と、テストが `is_err()` だけで
/// 文言を見ない形の両方をここで止める。
#[test]
fn every_refusal_to_write_is_named_by_a_test() {
    let src = index_cache_src();
    let phrases = refusal_phrases(&body_of(&src, "encode_all"));
    assert!(
        !phrases.is_empty(),
        "`encode_all` に `refusing to write:` が1つも無い。門番が消えたか、綴りが変わった"
    );

    let short: Vec<&String> = phrases.iter().filter(|p| p.len() < MIN_PHRASE).collect();
    assert!(
        short.is_empty(),
        "門番の文言の固定部分が短すぎる。`contains` が題材に当たって検査が恒真になる。\
         書式指定の間に句を1つ入れること:\n{}",
        short
            .iter()
            .map(|s| s.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    );

    // 書く側を名乗るテストの**本体だけ**を集める。
    // `split("fn ")` で切ると次のテストの doc まで入り、散文に当たって恒真になる
    let write_side: String = fn_names(&src)
        .into_iter()
        .filter(|n| n.ends_with("_not_written") || n.ends_with("_neither_written_nor_read"))
        .map(|n| body_of(&src, &n))
        .collect();

    let missing: Vec<&str> = phrases
        .iter()
        .map(String::as_str)
        .filter(|p| !write_side.contains(p))
        .collect();

    assert!(
        missing.is_empty(),
        "この文言を `contains` で見ている書き側のテストが無い。\
         `is_err()` だけで終わらせないこと:\n{}",
        missing.join("\n")
    );
}

/// **ヘッダの検査は構造の門番の綴りを名乗らないこと。**
///
/// 版 / magic / root hash を見るテストは「blob を読めるか」の族で、
/// `encode_all` / `decode_all` の本体の構造の門番とは別。同じ綴りを持つと、
/// 綴りで数えたときに構造の門番の本数が合わなくなる。
#[test]
fn no_header_check_is_named_like_a_structural_guard() {
    const CONVENTION: [&str; 3] = ["_not_written", "_refused", "_neither_written_nor_read"];
    // `header_for` はヘッダを組むテスト用ヘルパ。長さと `file_id` を見るテストは
    // これを呼ぶだけで `MAGIC` などの綴りを持たないので、綴り3つでは届かない
    const HEADER: [&str; 4] = ["MAGIC", "VERSION", "root_hash", "header_for"];

    let src = index_cache_src();
    let offenders: Vec<String> = fn_names(&src)
        .into_iter()
        .filter(|n| CONVENTION.iter().any(|w| n.ends_with(w)))
        .filter(|n| {
            let body = body_of(&src, n);
            HEADER.iter().any(|h| body.contains(h))
        })
        .collect();

    assert!(
        offenders.is_empty(),
        "ヘッダの検査が構造の門番の綴りを名乗っている。何を守っているかを\
         名前に持たせること（`..._cannot_be_read` など）:\n{}",
        offenders.join("\n")
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **最初の `{` で切らないこと。**
    ///
    /// 切ると `bucket` になり、書き側テストの題材に当たって検査が恒真になる。
    #[test]
    fn a_phrase_is_the_longest_part_between_the_format_holes() {
        assert_eq!(
            longest_fixed_part("bucket {b} is not sorted"),
            "is not sorted"
        );
        assert_eq!(
            longest_fixed_part("node_id {} is out of range for file {} (nodes {nodes})"),
            "is out of range for file"
        );
    }

    /// **固定部分が無い文言は空を返し、呼び手が落とす。**
    #[test]
    fn a_message_that_is_all_format_holes_yields_nothing() {
        assert_eq!(longest_fixed_part("{n} {b}"), "");
        assert!("".len() < MIN_PHRASE);
    }

    /// **`{{` / `}}` は書式指定でなく波括弧そのもの。**
    #[test]
    fn escaped_braces_are_not_format_holes() {
        assert_eq!(
            longest_fixed_part("the shape {{node}} is not writable here"),
            "the shape {node} is not writable here"
        );
    }

    /// **畳んだものは全部戻す。戻し先はソースの綴り。**
    ///
    /// 往復は恒等ではない。`{{` は実行時に `{` になり、テストのソースも `{` と書く。
    /// `\"` は実行時に `"` になるが、テストのソースは `\"` と書く。
    /// **どちらも「実行時の値をソースでどう綴るか」へ戻している。**
    /// 片方だけ戻すと、返る句が照合先（生のソース）と食い違って偽の赤になる。
    #[test]
    fn folding_and_unfolding_lands_on_the_source_spelling() {
        for (input, want) in [
            ("plain", "plain"),
            ("{{node}}", "{node}"),
            ("a \\\"b\\\" c", "a \\\"b\\\" c"),
            ("{{a}} and \\\"b\\\"", "{a} and \\\"b\\\""),
        ] {
            assert_eq!(
                unfold_escapes(&fold_escapes(input)),
                want,
                "戻し先が違う: {input}"
            );
        }
    }

    /// **句の途中に引用符があっても、ソースの綴りで返す。**
    #[test]
    fn a_quote_inside_a_phrase_comes_back_escaped() {
        assert_eq!(
            longest_fixed_part("the path \\\"a\\\" must be under {root}"),
            "the path \\\"a\\\" must be under"
        );
    }

    /// **エスケープした `"` は畳んでから割る。**
    #[test]
    fn an_escaped_quote_is_folded_before_splitting() {
        assert_eq!(
            longest_fixed_part("file \\\"{}\\\" has no node table at all"),
            "\\\" has no node table at all"
        );
    }

    /// **`\` で継いだ行は、字下げごと詰める。**
    #[test]
    fn a_continued_line_joins_without_its_indent() {
        assert_eq!(
            longest_fixed_part("fork range {}+{} is out of the fork table \\\n     for file {f}"),
            "is out of the fork table for file"
        );
    }
}
