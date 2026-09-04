//! 検査が歩く「本番のソースの根」を1箇所で決める。
//!
//! **`src/` だけを見る検査を書かせない。** スライスは workspace の crate に
//! 割ってあるので（ADR-0009 決定1）、`src/` だけを歩く検査はアプリの組み立てしか
//! 見ない。落ちる違反が無くなるのではなく、**見る対象が無くなる**——
//! 検査は緑のまま何もしていない状態になる。
//!
//! **`dead_code` を許す。** 結合テストは1ファイル1クレートで、この module は
//! それぞれに別々にコンパイルされる。どのクレートも使うのは一部だけ。
#![allow(dead_code)]

use std::path::{Path, PathBuf};

/// 本番のソースが置かれている根の一覧。
///
/// **`src/` だけを見ない。** スライスは workspace の crate に割ってあるので
/// （ADR-0009 決定1）、`src/` だけを歩く検査は**アプリの組み立てしか見ない**。
/// 落ちる違反が無くなるのではなく、見る対象が無くなる——検査は緑のまま何も
/// していない状態になる。
///
/// 一覧は `crates/*/src` を**その場で数える**。手で並べると、crate を1つ足した
/// 人がそこへ書き忘れても何も落ちない。
pub fn production_roots() -> Vec<PathBuf> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut roots = vec![manifest.join("src")];

    if let Ok(entries) = std::fs::read_dir(manifest.join("crates")) {
        let mut found: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path().join("src"))
            .filter(|p| p.is_dir())
            .collect();
        found.sort();
        roots.extend(found);
    }
    roots
}

/// 根の一覧が空振りしていないこと。
///
/// **`crates/` があるのに1つも拾えていない状態を通さない。** そこを通すと、
/// この一覧を使う検査すべてが「違反0」で緑になる。
#[test]
fn every_crate_is_walked() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let roots = production_roots();

    assert!(
        roots.first().is_some_and(|p| p.ends_with("src")),
        "アプリの `src` が一覧に無い"
    );

    let Ok(entries) = std::fs::read_dir(manifest.join("crates")) else {
        return; // まだ crate に割っていない
    };
    let declared = entries
        .flatten()
        .filter(|e| e.path().join("src").is_dir())
        .count();
    assert_eq!(
        roots.len() - 1,
        declared,
        "crates/ の下に src を持つ crate が {declared} 個あるのに {} 個しか歩いていない",
        roots.len() - 1
    );
    assert!(declared > 0, "crates/ があるのに src を持つ crate が無い");
}
