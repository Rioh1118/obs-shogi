//! テスト用の棋譜の材料。
//!
//! 手合割の一覧はクレートの表（`handicap.rs`）に対応するドメインの知識で、
//! 複数のテストが同じものを必要とする。各テストに写すと、クレートが手合割を
//! 足したときに直す場所が増え、**片方だけ直しても両方緑のまま通る**。

use std::path::PathBuf;

/// 平手を除く手合割の全種。クレートの `HANDICAPS` から平手を抜いたもの
pub const HANDICAPS: [&str; 15] = [
    "香落ち",
    "右香落ち",
    "角落ち",
    "飛車落ち",
    "飛香落ち",
    "二枚落ち",
    "三枚落ち",
    "四枚落ち",
    "五枚落ち",
    "左五枚落ち",
    "六枚落ち",
    "右七枚落ち",
    "左七枚落ち",
    "八枚落ち",
    "十枚落ち",
];

/// 手合割の名前だけが違う1手の KIF。
///
/// 手合割つきは上手（後手）から指すので初手が平手と異なる。
/// ３三の歩はどの手合割でも落ちないので、上手の初手として全種で使える。
pub fn one_move_kif(handicap: &str) -> String {
    let first = if handicap == "平手" {
        "７六歩(77)"
    } else {
        "３四歩(33)"
    };
    format!(
        "手合割：{handicap}\n\
         手数----指手---------消費時間--\n   \
         1 {first}   ( 0:01/00:00:01)\n"
    )
}

/// テストごとに分かれた空の一時ディレクトリ。
///
/// 中身を消してから作り直す。前回の実行が assert で落ちて後始末に届かなかった場合、
/// 残骸が次の実行に混ざる。
pub fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "obs-shogi-{tag}-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("一時ディレクトリ");
    dir
}
