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
const EXPECTED_MIN: usize = 163;

/// 取り込み忘れを許す幅。**1回の作業で足すテストの本数の目安。**
/// これ以上ずれたら更新忘れとみなす。
///
/// 広げるほど検出力が落ちる。幅が N なら、常に N 本までは消しても緑で通る。
const DRIFT_ALLOWANCE: usize = 20;

/// `#[test]` の総数を数える。
///
/// **行が属性そのものであるものだけ数える。** 文字列リテラルやコメントの中の
/// 属性の綴りを数えると、コメントを膨らませるだけで下限を水増しできる
/// （このファイル自身、属性は2本しか無いのに綴りはそれより多く現れる）。
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
        total += source
            .lines()
            .filter(|line| line.trim_start().starts_with("#[test]"))
            .count();
    }

    total
}

/// `src` と `tests` の両方を見る。
///
/// **`tests/` を外してはいけない。** `root_guard.rs` は、パスを受け取る Tauri
/// コマンドが root 配下を確かめていることを見る関門で、消えて一番困るテストが
/// そこにある。
fn count_all_tests() -> usize {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    count_tests(&manifest.join("src")) + count_tests(&manifest.join("tests"))
}

#[test]
fn the_number_of_tests_does_not_go_down() {
    let found = count_all_tests();

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
/// 例えば 163 のまま 200 本まで増やすと、37 本消しても緑で通る。
#[test]
fn the_expected_number_is_kept_up_to_date() {
    let found = count_all_tests();

    assert!(
        found <= EXPECTED_MIN + DRIFT_ALLOWANCE,
        "テストが {} 本増えている（{found} > {}）。\n\
         EXPECTED_MIN を {found} へ上げること。放っておくと、次に消えたときに検出できない。",
        found - EXPECTED_MIN,
        EXPECTED_MIN + DRIFT_ALLOWANCE
    );
}
