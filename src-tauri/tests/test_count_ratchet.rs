//! `#[test]` の本数が減っていないことを見る。
//!
//! **テストは消しても緑になる。** 編集スクリプトのスパン置換で範囲を巻き添えに
//! すると、同じコミットで別のテストを足していれば本数が減らず、消えたことに
//! 気づけない。ガードのコード自体は残るので、それを外す変更が後から緑で通る。
//!
//! カバレッジでは代わりにならない。カバレッジが落ちるのは「コードが実行されなく
//! なったとき」で、ここで見たいのは「守るテストだけが消えたとき」。
//!
//! crate をリンクせずソースを文字列として読む（`root_guard.rs` と同じ形）。
//! crate の内部を見るテストは `src` 側の `#[cfg(test)]` に置く。

use std::fs;
use std::path::Path;

/// 現在の本数。**下げるときは理由をコミットメッセージに書くこと。**
/// 上げるのは自由（足したぶんだけ上がる）。
const EXPECTED_MIN: usize = 148;

/// `#[test]` の総数を数える。
///
/// 属性の綴りは1つしか使っていないが、`#[tokio::test]` などが増えたらここへ足す。
fn count_tests(dir: &Path) -> usize {
    let mut total = 0;
    let entries = fs::read_dir(dir).expect("src/ を読めない");

    for entry in entries {
        let path = entry.expect("ディレクトリの要素を読めない").path();
        if path.is_dir() {
            total += count_tests(&path);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let source = fs::read_to_string(&path).expect("ソースを読めない");
        total += source.matches("#[test]").count();
    }

    total
}

#[test]
fn the_number_of_tests_does_not_go_down() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let found = count_tests(&root);

    assert!(
        found >= EXPECTED_MIN,
        "テストが {} 本減っている（{found} < {EXPECTED_MIN}）。\n\
         消したなら EXPECTED_MIN を下げ、なぜ消したのかをコミットメッセージに書くこと。\n\
         編集スクリプトの巻き添えなら、消えた範囲を復元すること。",
        EXPECTED_MIN - found
    );
}

/// 増えたぶんを取り込み忘れると、次に消えたときの検出力が落ちる。
///
/// 例えば 148 のまま 200 本まで増やすと、57 本消しても緑で通る。
#[test]
fn the_expected_number_is_kept_up_to_date() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let found = count_tests(&root);

    assert!(
        found <= EXPECTED_MIN + 20,
        "テストが {} 本増えている（{found} > {EXPECTED_MIN}）。\n\
         EXPECTED_MIN を {found} へ上げること。放っておくと、次に消えたときに検出できない。",
        found - EXPECTED_MIN
    );
}
