//! 読めなかった行を、**利用者が次に何をすればよいか**まで言える失敗にする。
//!
//! 定跡は配布物なので、直せるのは「別のものを取り直す」か「配布元へ言う」しかない。
//! だから何行目のどんな綴りで落ちたかを必ず添える —— 行番号が無いと、
//! 100 万行のファイルのどこが壊れているか誰にも分からない。
//!
//! 抜粋は `excerpt` が長さと不可視文字を抑える。ここでは組み立てだけを持つ。

use crate::book::error::{BookError, BookErrorCode};

/// 失敗に行番号を前置する。
///
/// `to_book_key_in_file` は行の中身しか知らないので、位置はここで足す。
pub(super) fn annotate_line(err: BookError, line_number: usize) -> BookError {
    let annotated = BookError::new(err.code(), format!("{line_number}行目: {}", err.message()));
    match err.path() {
        Some(path) => annotated.with_path(path),
        None => annotated,
    }
}

pub(super) fn invalid_content(message: &str, path: &str) -> BookError {
    BookError::new(BookErrorCode::InvalidContent, message).with_path(path)
}

/// 局面が1つも書かれていないファイルの文面。
///
/// **2箇所から出る**（局面行に一度も当たらずに読み終わった場合と、注記だけの
/// 場合）。利用者から見れば同じ状況なので、同じ文面にする。
///
/// **原因を1つに断定しない。復帰操作に「取得し直す」を置かない。** ShogiHome は
/// 空の定跡を見出し1行だけのファイルとして書き出す（`storeYaneuraOuBook`。
/// 指し手が0の項目は書かないので、全ての指し手を消した定跡も同じ形になる）。
/// 利用者が自分で作ったばかりのファイルには取得元が無い。
pub(super) const EMPTY_OF_POSITIONS: &str = "この定跡には局面が1つも入っていない\
                                  （まだ何も登録されていないか、途中で切れている）。\
                                  別の定跡を開くこと";
