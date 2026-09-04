//! 索引キャッシュの門番と、**それを名乗るテスト**を突き合わせる。
//!
//! `search/cache/index_cache.rs` の `mod tests` の直上に綴りの規約がある——
//! 書く側だけを見るなら `_not_written`、読む側だけなら `_refused`、
//! 両方なら `_neither_written_nor_read`。次に門番を足す人はその綴りで
//! 「どの門番に留めがあるか」を数える。
//!
//! **人が手で数える形は続かない。** この規約を書いた doc の数字は
//! 書いた回のうちに3回外れた（綴りに copula を含めた / `rejected` が
//! 集合の外に落ちた / 読み側だけ規則を変えて足した）。
//!
//! だからここは**数字を doc に持たせない。** 見るのは2つだけ。
//!
//! 1. 規約の外の綴りでテストが名乗っていないか（`rejected` など）
//! 2. `encode_all` の `refusing to write:` の文言それぞれに、
//!    書く側を名乗るテストがその文言を `contains` で見ているか
//!
//! **`decode_all` の側は数えない。** あちらの `return Err` は門番だけでなく
//! 長さや `file_id` の検査も含み、文言と門番が1対1にならない。
//!
//! **両側を見るテストの中では、どちらの assert かを見分けられない。**
//! `_neither_written_nor_read` は本体に読む側の assert も持つので、
//! 書く側の assert だけを消しても2は落ちない。**それは人が見ること。**
//! 落とせるのは「文言がテストのどこにも無い」形と「門番の文言を変えた」形。

use std::fs;
use std::path::PathBuf;

mod roots;
mod scanning;
use scanning::blank_out_strings;

fn index_cache_src() -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/search/cache/index_cache.rs");
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()))
}

/// `fn <名前>` の名前を集める。
///
/// **文字列を潰してから読む。** doc コメントの中に書いた `fn foo()` の例を
/// 本物の定義として拾わないため。
fn fn_names(src: &str) -> Vec<String> {
    let blanked = blank_out_strings(src);
    blanked
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

/// `refusing to write: ` に続く、書式指定の手前までの文言。
fn refusal_phrases(src: &str) -> Vec<String> {
    const MARK: &str = "refusing to write: ";
    src.lines()
        .filter_map(|l| {
            let rest = &l[l.find(MARK)? + MARK.len()..];
            let end = rest.find(['{', '"', '\\']).unwrap_or(rest.len());
            let p = rest[..end].trim().to_owned();
            (!p.is_empty()).then_some(p)
        })
        .collect()
}

/// **`encode_all` が断る文言それぞれに、書く側を名乗るテストがあること。**
///
/// 門番を足したのにテストを足さない形と、テストが `is_err()` だけで
/// 文言を見ない形の両方をここで止める。
#[test]
fn every_refusal_to_write_is_named_by_a_test() {
    let src = index_cache_src();
    let phrases = refusal_phrases(&src);
    assert!(
        !phrases.is_empty(),
        "`refusing to write:` が1つも無い。書き側の門番が消えたか、綴りが変わった"
    );

    // 書く側を名乗るテストの本体だけを集める
    let write_side: String = src
        .split("fn ")
        .filter(|b| {
            let head: String = b
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '_')
                .collect();
            head.ends_with("_not_written") || head.ends_with("_neither_written_nor_read")
        })
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
