//! `docs/state-transitions/search.md` が名乗るテストとコマンドが実在するか。
//!
//! この doc の状態表は「どうやってその段に入るか」を答えるための索引で、
//! 読み手はそこに書かれた綴りで現物を引く。**引けないと、表が古いのか
//! 実装が消えたのかを判断できない。**
//!
//! 既存の `state_transition_cells` は `game-session.md` **だけ**を読む。
//! あちらは表のセルとテストの名乗りを突き合わせる形だが、`search.md` の表は
//! 形が違う（セルでなく「判定条件」の欄）ので、ここは**綴りの実在だけ**を見る。
//!
//! **見るのは2つ。**
//!
//! 1. バッククォートで囲んだ `fn` 名が `src/search/**` に実在するか
//! 2. `restart(Restart::X)` のような**呼び出しの並び**が `src/search/**` に実在するか
//!
//! **散文は見ていない。** 「〜が固定している」の主張が本当かは人が見る。

use std::fs;
use std::path::{Path, PathBuf};

mod roots;
mod scanning;
use scanning::blank_out_comments;

fn doc() -> String {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri の親")
        .join("docs/state-transitions/search.md");
    fs::read_to_string(&p).unwrap_or_else(|e| panic!("{} を読めない: {e}", p.display()))
}

/// `src/search/**` の中身を、コメントを潰して1つに繋げたもの。
///
/// **コメントを潰す。** doc が指す綴りが、別のコメントに書いてあるだけで
/// 「実在する」と判定されると、この検査は何も止めない。
fn search_sources() -> String {
    fn walk(dir: &Path, out: &mut String) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                if let Ok(s) = fs::read_to_string(&p) {
                    out.push_str(&blank_out_comments(&s));
                    out.push('\n');
                }
            }
        }
    }
    let mut out = String::new();
    walk(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/search"),
        &mut out,
    );
    out
}

/// バッククォートで囲まれた断片を返す。
fn quoted(md: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = md;
    while let Some(a) = rest.find('`') {
        let after = &rest[a + 1..];
        let Some(b) = after.find('`') else { break };
        let inner = &after[..b];
        if !inner.is_empty() {
            out.push(inner.to_owned());
        }
        rest = &after[b + 1..];
    }
    out
}

/// **doc が名乗る `fn` 名が実在すること。**
///
/// 綴りは `a_..._b` の形（小文字・数字・下線だけで、下線を2つ以上含む）に絞る。
/// 型名や1語の識別子まで見ると、別の意味で使われている綴りを拾って偽の赤になる。
#[test]
fn every_test_named_by_the_doc_exists() {
    let src = search_sources();
    let missing: Vec<String> = quoted(&doc())
        .into_iter()
        .filter(|q| {
            q.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
                && q.matches('_').count() >= 2
        })
        .filter(|q| !src.contains(&format!("fn {q}")))
        .collect();

    assert!(
        missing.is_empty(),
        "`search.md` が名乗る fn が `src/search/**` に無い。\
         改名したら doc も直すこと:\n{}",
        missing.join("\n")
    );
}

/// **doc が書く呼び出しの並びが実在すること。**
///
/// `restart(Restart::Building)` のような、引数まで含めた形。
/// これが引けないと、表の「判定条件」の欄が索引として働かない。
#[test]
fn every_call_written_by_the_doc_exists() {
    let src = search_sources();
    let missing: Vec<String> = quoted(&doc())
        .into_iter()
        // `名前(引数)` の形だけ。`..` を含むものは略記なので除く
        .filter(|q| {
            let Some((head, tail)) = q.split_once('(') else {
                return false;
            };
            tail.ends_with(')')
                && !q.contains("..")
                // 呼び出しの頭は識別子（`Err(..)` のような型や `(size, mtime)` を外す）
                && !head.is_empty()
                && head
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        })
        .filter(|q| !src.contains(q.as_str()))
        .collect();

    assert!(
        missing.is_empty(),
        "`search.md` が書く呼び出しが `src/search/**` に無い。\
         口を変えたら doc も直すこと:\n{}",
        missing.join("\n")
    );
}
