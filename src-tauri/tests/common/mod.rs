//! 走査系のテストが共有する道具。
//!
//! `tests/` の直下に置くと cargo がテストターゲットとして拾ってしまうので、
//! ディレクトリの中に入れる（`mod.rs` はターゲットにならない）。

#![allow(dead_code)]

/// `/* */` と `//` を落とす。関数名をコメントに書く習慣があるので、
/// 落とさないと「呼んでいない」を「呼んでいる」と読み違える。
///
/// 文字列リテラルの中の `//` は、その行の残りが落ちるだけ（偽陽性）。
/// **`/*` は違う。** 文字列の中にあると次の `*/` までが丸ごと落ち、その範囲の
/// `#[command]` が走査から消える（偽陰性）。いまソースに `/*` を含む文字列は無い
pub fn without_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let bytes = source.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(b"/*") {
            match source[i + 2..].find("*/") {
                Some(at) => i += 2 + at + 2,
                None => break,
            }
            continue;
        }
        if bytes[i..].starts_with(b"//") {
            match source[i..].find('\n') {
                Some(at) => i += at,
                None => break,
            }
            continue;
        }
        out.push(source[i..].chars().next().expect("境界がずれている"));
        i += source[i..]
            .chars()
            .next()
            .map(|c| c.len_utf8())
            .expect("境界がずれている");
    }
    out
}
