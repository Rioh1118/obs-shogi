//! 本番コードに `.unwrap()` を残さない。
//!
//! Tauri のコマンドの中で panic すると、そのタスクが飛んで応答チャンネルが落ち、
//! **`invoke` の promise が永久に解決しない**。利用者に見えるのは
//! 「押しても何も起きない」で、ログにも何も出ない。
//!
//! `.expect("理由")` は通す。**理由を書けるなら、それは判断であって放置ではない。**
//! 書けないなら `?` か `unwrap_or_default()` にすること。
//!
//! 数えるのではなく 0 で固定してある。いま 0 なので、増やす側が説明を書く。
//!
//! **「本番に残っているのはここだけ」を人が数えない。** 数えた側は1件直して
//! 「唯一」と書けてしまい、同じ形の兄弟が別のファイルに残る。
//! 件数を言いたくなったらこの検査を走らせること。

mod scanning;

use scanning::{production_code_of, strip_test_modules};

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

fn production_code(path: &Path) -> String {
    production_code_of(&fs::read_to_string(path).unwrap_or_default(), path)
}

fn src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

#[test]
fn production_code_has_no_bare_unwrap() {
    let mut offenders = Vec::new();

    for path in rust_files(&src_dir()) {
        for (number, line) in production_code(&path).lines().enumerate() {
            if line.contains(".unwrap()") {
                offenders.push(format!(
                    "{}:{}  {}",
                    path.display(),
                    number + 1,
                    line.trim()
                ));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "本番コードに `.unwrap()` がある。理由を書けるなら `.expect(\"理由\")`、\
         書けないなら `?` か `unwrap_or_default()` にすること:\n{}",
        offenders.join("\n")
    );
}

/// 走査が空振りしても違反0になる。歩けていることを別に固定する。
///
/// `strip_test_modules` が括弧を数え違えて本番コードごと落とすと、
/// 上の検査は静かに緑になる。ここが先に落ちる
#[test]
fn the_scanner_still_sees_production_code() {
    let files = rust_files(&src_dir());
    assert!(files.len() > 10, "{} ファイルしか歩けていない", files.len());

    let total: usize = files.iter().map(|p| production_code(p).len()).sum();
    assert!(total > 100_000, "本番コードが {total} 文字しか残っていない");

    // `#[cfg(test)]` の中だけにある綴りが落ちていること。
    // これが残るなら、塊を落とせていない
    let session = production_code(&src_dir().join("engine").join("game").join("session.rs"));
    assert!(
        !session.contains("fn two_humans"),
        "`#[cfg(test)]` の中を落とせていない"
    );
    assert!(
        session.contains("async fn on_tick"),
        "本番の関数まで落としている"
    );

    // **塊を持たない `#[cfg(test)]` の後ろが飲まれていないこと。**
    // 総文字数では落ちない（`protocol.rs` の26行が消えても10万文字は残る）ので、
    // 消えたら落ちる綴りを名指しで置く
    let protocol = production_code(&src_dir().join("engine").join("protocol.rs"));
    assert!(
        protocol.contains("enum ReadyState"),
        "`#[cfg(test)] const ALL` の後ろにある本番の宣言まで落としている"
    );
    let root = production_code(&src_dir().join("lib.rs"));
    assert!(
        root.contains("pub mod workspace"),
        "`#[cfg(test)] mod` の後ろにある本番の宣言まで落としている"
    );

    // **doc コメントの中の `#[cfg(test)]` から走り出していないこと。**
    // `lib.rs` の `CLOSE_TIMEOUT` の doc がその綴りを含む
    assert!(
        root.contains("pub const CLOSE_TIMEOUT"),
        "コメントの中の `#[cfg(test)]` を item の始まりとして数えている"
    );
}

/// 走査そのものを、文字列を直に食わせて確かめる。
///
/// **現物を食わせて違反0、では走査が壊れても緑になる。** 落とすべきものと
/// 残すべきものを1つずつ並べて、境目を固定する。
#[test]
fn the_stripper_drops_the_item_and_nothing_more() {
    // 塊を持たない item。**次の `{` まで飲まない**
    let source = "\
#[cfg(test)]
const ALL: &[u8] = &[];
pub enum Real {
    A,
}
";
    let stripped = strip_test_modules(source, Path::new("<テスト>"));
    assert!(
        !stripped.contains("const ALL"),
        "テスト用の const が残っている"
    );
    assert!(
        stripped.contains("pub enum Real"),
        "後ろの本番コードまで落としている: {stripped:?}"
    );

    // 波括弧を持つ `use`。`;` まで食う
    let source = "#[cfg(test)]\nuse a::{b, c};\npub fn real() {}\n";
    let stripped = strip_test_modules(source, Path::new("<テスト>"));
    assert!(!stripped.contains("use a::"), "テスト用の use が残っている");
    assert!(
        stripped.contains("pub fn real"),
        "後ろの本番コードまで落としている: {stripped:?}"
    );

    // 塊。中身ごと落ちる
    let source = "#[cfg(test)]\nmod tests {\n    fn t() { x.unwrap(); }\n}\npub fn real() {}\n";
    let stripped = strip_test_modules(source, Path::new("<テスト>"));
    assert!(!stripped.contains("unwrap"), "塊の中が残っている");
    assert!(stripped.contains("pub fn real"), "塊の後ろまで落としている");

    // **文字列の中の `//` で行を切らないこと。** 切ると、そこから右にある
    // `.unwrap()` が全部見えなくなる（URL は本番コードに普通に書く）。
    // **合成を食わせる**——ヘルパ単体を見ても、`production_code` が
    // そのヘルパを使っているかは分からない
    let source = "let doc = \"https://example.org\"; let x = v.unwrap();\n";
    let kept = production_code_of(source, Path::new("<テスト>"));
    assert!(
        kept.contains("v.unwrap()"),
        "文字列の中の `//` で行を切っている: {kept:?}"
    );

    // **行番号が保たれること。** 詰めると違反の `path:line` が現物とずれる
    let source = "pub fn a() {}\n#[cfg(test)]\nmod t {\n}\npub fn b() {}\n";
    let stripped = strip_test_modules(source, Path::new("<テスト>"));
    let at = stripped
        .lines()
        .position(|l| l.contains("pub fn b"))
        .expect("本番の関数が消えている");
    assert_eq!(at, 4, "行番号がずれている: {stripped:?}");
}
