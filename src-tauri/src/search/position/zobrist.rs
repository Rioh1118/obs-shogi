//! Zobrist ハッシュの乱数表。**局面も索引も知らない。**
//!
//! 局面を「手番」「盤上の各駒」「各駒種の持駒枚数」にばらしたとき、その項1つに
//! 対応する乱数を返す。返るのは [`ZobristValue`] で、**鍵ではない**。
//! 鍵はこれを XOR で畳んだ結果で、畳む側は [`super::position_key`] にある。
//!
//! **添字の付け方はこのファイルの外に出さない。** 出すと同じ規約が2箇所に書かれ、
//! 片方だけ直したときに同じ局面から別の鍵が出る。

use std::sync::OnceLock;

use shogi_core::{Color, Piece, PieceKind, Square};

/// 表が持つ128ビットの乱数。
///
/// [`super::position_key::PositionKey`] と同じ形をしているが**別物**。
/// あちらは局面を指す鍵で、こちらはそれを組み立てる材料。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ZobristValue {
    pub(super) z0: u64,
    pub(super) z1: u64,
}

impl ZobristValue {
    const ZERO: Self = Self { z0: 0, z1: 0 };

    /// 2つの項を畳む。XOR は自分自身が逆演算なので、足すのも消すのも同じ操作。
    #[inline]
    pub(super) fn xor(self, rhs: ZobristValue) -> Self {
        Self {
            z0: self.z0 ^ rhs.z0,
            z1: self.z1 ^ rhs.z1,
        }
    }
}

// 持ち駒に出るのは基本この7種（成駒は持てない）
const HAND_KINDS: [PieceKind; 7] = [
    PieceKind::Pawn,
    PieceKind::Lance,
    PieceKind::Knight,
    PieceKind::Silver,
    PieceKind::Gold,
    PieceKind::Bishop,
    PieceKind::Rook,
];

/// 持駒の**枚数**を添字にするので、枚数1つにつき1枠要る。
///
/// 一番多く持てるのは歩の18枚なので、`0..=18` の19枠。他の駒種も同じ枠で持つ。
/// **これは総数ではなく、駒種ごとの枚数の値域。**
const HAND_COUNT_SLOTS: usize = 19;

/// 表の添字にする手番。`Color` には添字が無いので、ここで 0 / 1 に決める。
#[inline]
fn color_index(c: Color) -> usize {
    match c {
        Color::Black => 0,
        Color::White => 1,
    }
}

/// 局面の項ごとに引く乱数の表。
///
/// 添字の付け方がそのまま鍵の定義になる。**ここを変えると同じ局面から別の鍵が出る**
/// ので、既に書いた索引は読めなくなる。
struct ZobristTable {
    side: [ZobristValue; 2],
    // board[color][piece_kind(14)][square(81)]
    board: [[[ZobristValue; 81]; 14]; 2],
    // hand[color][hand_kind(7)][count(0..=18)]
    hand: [[[ZobristValue; HAND_COUNT_SLOTS]; 7]; 2],
}

/// 表は起動ごとに一度だけ作る。約7万項あるので使う側で持ち回らない。
///
/// **乱数だが、毎回同じ値でなければならない。** 鍵はディスクの索引に書かれるので、
/// 次の起動で表が変われば、書いてある鍵が全部別の局面を指すことになる。
/// 乱数源に環境や時刻を混ぜず、固定の種から決まった手順で作るのはそのため。
static ZOBRIST: OnceLock<ZobristTable> = OnceLock::new();

impl ZobristTable {
    fn new() -> Self {
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut side = [ZobristValue::ZERO; 2];
        let mut board = [[[ZobristValue::ZERO; 81]; 14]; 2];
        let mut hand = [[[ZobristValue::ZERO; HAND_COUNT_SLOTS]; 7]; 2];

        for c in 0..2 {
            side[c] = next128(&mut seed);
            for pk_row in board[c].iter_mut() {
                for cell in pk_row.iter_mut() {
                    *cell = next128(&mut seed);
                }
            }
            for hk_row in hand[c].iter_mut() {
                for cell in hk_row.iter_mut() {
                    *cell = next128(&mut seed);
                }
            }
        }

        Self { side, board, hand }
    }
}

/// 表の1項ぶん、128ビットを取り出す。64ビットを2回引いて上下に充てる。
#[inline]
fn next128(seed: &mut u64) -> ZobristValue {
    ZobristValue {
        z0: splitmix64(seed),
        z1: splitmix64(seed),
    }
}

/// 種を1つ進めて64ビットを返す、決まった手順の乱数。
///
/// 状態が `u64` 1個だけで、同じ種からは必ず同じ列が出る。
/// 表を毎回同じに作るという要件（[`ZOBRIST`]）を満たすのに要るのはこれだけで、
/// 統計的な質は問わない。
#[inline]
fn splitmix64(x: &mut u64) -> u64 {
    *x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// 「手番がこの色である」ことの項。
#[inline]
pub(super) fn side(c: Color) -> ZobristValue {
    ZOBRIST.get_or_init(ZobristTable::new).side[color_index(c)]
}

/// 「この色のこの駒種が、この升にいる」ことの項。
///
/// 同じ駒でも升が違えば別の項になる。だから盤の配置がそのまま鍵に効く。
#[inline]
pub(super) fn piece_on_square(piece: Piece, sq: Square) -> ZobristValue {
    let tbl = ZOBRIST.get_or_init(ZobristTable::new);
    let (pk, c) = piece.to_parts();
    // PieceKind::array_index() が 0..13 を返す想定
    tbl.board[color_index(c)][pk.array_index()][sq.array_index()]
}

/// 「この色がこの駒種を n 枚持っている」ことの項。
///
/// **持駒に出ない駒種（玉・成駒）では `None`。** 表に枠が無い。
///
/// 枠に収まらない枚数は末尾の枠へ落とす。**頭打ちをここに1つだけ置くことで、
/// 盤を舐める側と1手ずつ動かす側が必ず同じ枠を引く。** 2箇所に書くと、
/// 片方をずらしたときに同じ局面から別の鍵が出る。
#[inline]
pub(super) fn hand_count(c: Color, kind: PieceKind, n: usize) -> Option<ZobristValue> {
    let tbl = ZOBRIST.get_or_init(ZobristTable::new);
    let hk = HAND_KINDS.iter().position(|k| *k == kind)?;
    Some(tbl.hand[color_index(c)][hk][n.min(HAND_COUNT_SLOTS - 1)])
}

/// 持駒として数える7種。盤を舐める側が全種を引くために要る。
#[inline]
pub(super) fn hand_kinds() -> &'static [PieceKind; 7] {
    &HAND_KINDS
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 枠の境目を直に見る。
    ///
    /// **頭打ちはこのファイルの1箇所にしか無い。** 盤を舐める側と1手ずつ動かす側が
    /// 同じ枠を引くための集約だが、その代償として**両者を突き合わせる
    /// `walk_and_compare` では壊れ方が見えない** — 片方だけずれることが
    /// 起きえなくなり、壊れると両者が仲良く同じだけ間違う。
    ///
    /// 実際、`n.min(HAND_COUNT_SLOTS - 1)` を `n % HAND_COUNT_SLOTS` に変えても
    /// `position_key.rs` の5本は全部通る（題材の持駒が高々1枚のため）。
    /// 残るのは歩19枚が歩0枚と同じ鍵になる静かな衝突なので、ここで枠を直に見る。
    #[test]
    fn the_hand_slots_clamp_at_the_last_one() {
        // 枠の中は1枚ごとに別の項
        assert_ne!(
            hand_count(Color::Black, PieceKind::Pawn, 17),
            hand_count(Color::Black, PieceKind::Pawn, 18),
            "枠の中で項が重なっている"
        );

        // 枠の外は末尾へ落ちる。折り返さない
        let last = hand_count(Color::Black, PieceKind::Pawn, HAND_COUNT_SLOTS - 1);
        assert_eq!(
            hand_count(Color::Black, PieceKind::Pawn, HAND_COUNT_SLOTS),
            last,
            "枠の外が末尾へ落ちていない"
        );
        assert_eq!(
            hand_count(Color::Black, PieceKind::Pawn, 255),
            last,
            "u8 の上限で添字が飛んでいる"
        );

        // 手番と駒種で別の項
        assert_ne!(
            hand_count(Color::Black, PieceKind::Pawn, 3),
            hand_count(Color::White, PieceKind::Pawn, 3),
            "手番が項に効いていない"
        );
        assert_ne!(
            hand_count(Color::Black, PieceKind::Pawn, 3),
            hand_count(Color::Black, PieceKind::Lance, 3),
            "駒種が項に効いていない"
        );
    }

    /// 持駒に出ない駒種には枠が無い。
    ///
    /// `hand_step` はここが `None` を返すことを頼りにしている。
    #[test]
    fn kinds_that_never_reach_a_hand_have_no_slot() {
        assert!(
            hand_count(Color::Black, PieceKind::King, 0).is_none(),
            "玉に枠がある"
        );
        assert!(
            hand_count(Color::Black, PieceKind::ProPawn, 0).is_none(),
            "成駒に枠がある"
        );
    }
}
