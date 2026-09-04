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
//! 見るのは2つ。
//!
//! 1. 規約の外の綴りでテストが名乗っていないか
//! 2. `encode_all` が断る文言それぞれに、書く側を名乗るテストが
//!    **その文言の最長の固定部分**を `contains` で見ているか
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
//! **文言の固定部分が短いと恒真になる。** `bucket {b} ...` の `bucket` は
//! テストの題材にも出るので、`contains` が当たっても assert を見た証拠にならない。
//! だから [`MIN_PHRASE`] より短い固定部分しか持たない門番は**素通りさせずに落とす。**

use std::fs;
use std::path::PathBuf;

mod roots;
mod scanning;
use scanning::{blank_out_noncode, item_end, skip_literal_or_comment};

/// 門番の文言に要る固定部分の最小の長さ（バイト）。
///
/// **短いと `contains` が題材に当たって恒真になる。** 実際 `bucket` の6バイトは
/// 書き側テストの本体に43回出る。1語では足りず、句の長さが要る。
const MIN_PHRASE: usize = 10;

/// `refusing to write: ` の前に付く引用符まで含めた目印。
const MARK: &str = "\"refusing to write: ";

fn index_cache_src() -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/search/cache/index_cache.rs");
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()))
}

/// `fn <名前>` を**行頭一致で**集める。
///
/// `///` で始まる doc の中の `fn foo()` は前置詞が外れるので落ちる。
/// 文字列を潰すのは、複数行の文字列リテラルの中の行が `fn ` で始まる形のため。
/// **コメントは潰していない**ので、行頭一致をやめると `/* */` の中を拾い始める。
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

/// `fn <name>` から item の終わりまでを返す。
fn body_of(src: &str, name: &str) -> String {
    let head = format!("fn {name}");
    let Some(i) = src.find(&head) else {
        panic!("`{head}` が無い");
    };
    let after = &src[i..];
    let len = item_end(after).unwrap_or(after.len());
    after[..len].to_owned()
}

/// 書式指定を外した固定部分のうち、**最長のもの**。
///
/// `bucket {b} is not sorted` なら `is not sorted`。
/// 最初の `{` で切ると `bucket` になり、題材にも当たって検査が恒真になる。
///
/// `\` で行を継いだ文言は、継続の直後の字下げごと詰める（Rust の意味論と同じ）。
fn longest_fixed_part(literal: &str) -> String {
    let joined = join_line_continuations(literal);
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
    best
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
    found
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

    /// **`\` で継いだ行は、字下げごと詰める。**
    #[test]
    fn a_continued_line_joins_without_its_indent() {
        assert_eq!(
            longest_fixed_part("fork range {}+{} is out of the fork table \\\n     for file {f}"),
            "is out of the fork table for file"
        );
    }
}
