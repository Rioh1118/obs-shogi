//! 読めなかった行を、**利用者が次に何をすればよいか**まで言える失敗にする。
//!
//! 定跡は配布物なので、直せるのは「別のものを取り直す」か「配布元へ言う」しかない。
//! だから何行目のどんな綴りで落ちたかを必ず添える —— 行番号が無いと、
//! 100 万行のファイルのどこが壊れているか誰にも分からない。
//!
//! 抜粋は `excerpt` が長さと不可視文字を抑える。ここでは組み立てだけを持つ。

use super::lines::first_token;
use super::moves::looks_like_a_move;
use crate::book::error::{excerpt, BookError, BookErrorCode};

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

/// 局面より先に来た行の診断。
///
/// **見出しの有無で変えない。** 見出しは要求しないので、先頭の局面行を失った
/// 切れかけの定跡は、見出しがあれば本体のループで、無ければ見出し探索のループで
/// 同じ形に当たる。診断が割れると、利用者は同じ壊れ方に別の説明を受ける。
/// **行の形で説明を分ける。** 指し手なら「切れたファイル」、そうでなければ
/// 「別の形式」。片方に寄せると、どちらかの利用者が事実でないことを言われる
/// （`<!DOCTYPE html>` に「指し手が書かれている」と言う／やねうら王の指し手行に
/// 「別の形式かもしれない」と言う）。
///
/// **どちらにも引用を付ける。** 行が見えないと、利用者は何が起きたか画面から
/// 確かめられない。`looks_like_a_move` は形しか見ないので、普通の英文の1語目が
/// 指し手扱いになることがある。そのとき引用があれば読み手には分かる。
pub(super) fn before_any_position(line_number: usize, line: &str, path: &str) -> BookError {
    let message = if looks_like_a_move(first_token(line)) {
        format!(
            "局面より先に指し手が書かれている（{line_number}行目: {}）。\
             途中で切れたファイルかもしれない。取得し直すか、別の定跡を開くこと",
            excerpt(line)
        )
    } else {
        format!(
            "やねうら王テキスト定跡として読めない（{line_number}行目: {}）。\
             別の形式のファイルかもしれない。取得し直すか、別の定跡を開くこと",
            excerpt(line)
        )
    };
    invalid_content(&message, path)
}
