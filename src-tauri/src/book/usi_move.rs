//! USI の指し手の綴りを `shogi_core` の指し手にする。
//!
//! **`shogi_core` は綴る側（`ToUsi`）しか持っていない。** 読む側はここが唯一で、
//! 定跡に書かれている `usi_move` を局面に当てるために要る。
//!
//! 合法性は見ない。見るのは綴りとして成立しているかだけで、その局面で指せるかは
//! `PartialPosition::make_move` が決める（駒がある・自分の駒・打つ先が空、までを見る）。

use shogi_core::{Color, Move, Piece, PieceKind, Square};

/// 打てる駒の綴り。
///
/// **成駒が無いのは規則。** 打つ手は持駒から置く手で、持駒は必ず成っていない。
/// `+P*5e` のような綴りは USI に無い。
fn droppable(letter: u8) -> Option<PieceKind> {
    match letter {
        b'P' => Some(PieceKind::Pawn),
        b'L' => Some(PieceKind::Lance),
        b'N' => Some(PieceKind::Knight),
        b'S' => Some(PieceKind::Silver),
        b'G' => Some(PieceKind::Gold),
        b'B' => Some(PieceKind::Bishop),
        b'R' => Some(PieceKind::Rook),
        _ => None,
    }
}

/// `7g` のような升の綴り。筋は `1`〜`9`、段は `a`〜`i`。
///
/// **引き算の前に落とす。** `Square::new` は `file.wrapping_sub(1) >= 9` で範囲外を
/// 必ず `None` にするので、通してしまっても別の升には化けない。手前で落とすのは
/// **`file - b'0'` があふれるから** —— `'/'` のように `b'0'` を下回る綴りが来ると、
/// `overflow-checks` が有効なビルド（`src-tauri/Cargo.toml` に `[profile]` の
/// 上書きが無いので dev と test がそう）では**その場で panic する。**
fn square(file: u8, rank: u8) -> Option<Square> {
    if !file.is_ascii_digit() || file == b'0' {
        return None;
    }
    if !(b'a'..=b'i').contains(&rank) {
        return None;
    }
    Square::new(file - b'0', rank - b'a' + 1)
}

/// USI の指し手にする。綴りとして読めなければ `None`。
///
/// `side` は打つ手の駒の手番に要る —— 打つ手の綴りには手番が現れないので、
/// 局面の側から渡す。渡し間違えると `make_move` が「自分の駒ではない」で弾く。
///
/// 受けるのは3つの形だけ。`resign` / `win` / `none` のような**指し手でない綴りは
/// `None`**（定跡の `ponder` に `none` が入ることはあるが、それは指し手の欄ではない）。
///
/// ```text
/// 7g7f   盤上の手
/// 8h2b+  成る手
/// P*5e   打つ手
/// ```
pub(crate) fn to_core_move(usi: &str, side: Color) -> Option<Move> {
    let raw = usi.as_bytes();

    // 打つ手を先に見る。盤上の手と長さが同じなので、`*` の位置で分ける
    if raw.len() == 4 && raw[1] == b'*' {
        return Some(Move::Drop {
            piece: Piece::new(droppable(raw[0])?, side),
            to: square(raw[2], raw[3])?,
        });
    }

    let promote = match raw.len() {
        4 => false,
        5 if raw[4] == b'+' => true,
        _ => return None,
    };

    Some(Move::Normal {
        from: square(raw[0], raw[1])?,
        to: square(raw[2], raw[3])?,
        promote,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 盤上の手・成る手・打つ手の3つが、綴りどおりの升と駒になること。
    ///
    /// **升を突き合わせる。** 読めたかどうか（`is_some`）だけを見ると、
    /// 筋と段を取り違えた実装が緑のまま通る。
    #[test]
    fn reads_the_three_shapes() {
        assert_eq!(
            to_core_move("7g7f", Color::Black),
            Some(Move::Normal {
                from: Square::new(7, 7).unwrap(),
                to: Square::new(7, 6).unwrap(),
                promote: false,
            })
        );
        assert_eq!(
            to_core_move("8h2b+", Color::Black),
            Some(Move::Normal {
                from: Square::new(8, 8).unwrap(),
                to: Square::new(2, 2).unwrap(),
                promote: true,
            })
        );
        assert_eq!(
            to_core_move("P*5e", Color::White),
            Some(Move::Drop {
                piece: Piece::new(PieceKind::Pawn, Color::White),
                to: Square::new(5, 5).unwrap(),
            })
        );
    }

    /// 打つ手の駒の手番は、渡された手番になること。
    ///
    /// **ここを取り違えても `make_move` が弾くだけで、綴りは読めたままになる。**
    /// 「読めなかった」と「相手の駒を打とうとした」は定跡ビューでの見え方が違う
    /// （行き止まりか、壊れた行か）ので、手前で固定する。
    #[test]
    fn a_drop_takes_the_side_it_is_given() {
        let Some(Move::Drop { piece, .. }) = to_core_move("P*5e", Color::Black) else {
            panic!("打つ手として読めるはず");
        };
        assert_eq!(piece.color(), Color::Black);
    }

    /// 升として成立しない綴りは読めないこと。
    ///
    /// **`/` を並べてあるのは引き算のあふれを見るため。** `is_ascii_digit` の門を
    /// 外すと、`/`（`b'0'` の1つ下）はこのテストを**赤ではなく panic で**落とす
    /// （`overflow-checks` が有効なので）。`0` は引き算があふれないので、
    /// 同じ行に並んでいても落ち方が違う。
    #[test]
    fn rejects_squares_outside_the_board() {
        for usi in ["0g7f", "/g7f", "7j7f", "7g7z", "7g0f", "７六歩"] {
            assert_eq!(to_core_move(usi, Color::Black), None, "usi={usi}");
        }
    }

    /// 指し手でない綴りと、長さの違う綴りは読めないこと。
    #[test]
    fn rejects_what_is_not_a_move() {
        for usi in [
            "", "7g7", "7g7f++", "resign", "win", "none", "+P*5e", "K*5e",
        ] {
            assert_eq!(to_core_move(usi, Color::Black), None, "usi={usi}");
        }
    }
}
