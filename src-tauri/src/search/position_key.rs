use std::sync::OnceLock;

use shogi_core::{Color, Hand, Move, PartialPosition, Piece, PieceKind, Square};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PositionKey {
    pub z0: u64,
    pub z1: u64,
}

impl PositionKey {
    pub const ZERO: Self = Self { z0: 0, z1: 0 };

    #[inline]
    pub fn bucket(self) -> u8 {
        (self.z0 >> 56) as u8
    }

    #[inline]
    fn xor_assign(&mut self, rhs: PositionKey) {
        self.z0 ^= rhs.z0;
        self.z1 ^= rhs.z1;
    }
}

#[inline]
fn cidx(c: Color) -> usize {
    match c {
        Color::Black => 0,
        Color::White => 1,
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

// ざっくり最大19で確保（歩18 + 余裕1）。他の駒種もこの枠で持つ
const HAND_MAX: usize = 19;

struct ZobristTable {
    side: [PositionKey; 2],
    // board[color][piece_kind(14)][square(81)]
    board: [[[PositionKey; 81]; 14]; 2],
    // hand[color][hand_kind(7)][count(0..=18)]
    hand: [[[PositionKey; HAND_MAX]; 7]; 2],
}

static ZOBRIST: OnceLock<ZobristTable> = OnceLock::new();

impl ZobristTable {
    fn new() -> Self {
        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut side = [PositionKey::ZERO; 2];
        let mut board = [[[PositionKey::ZERO; 81]; 14]; 2];
        let mut hand = [[[PositionKey::ZERO; HAND_MAX]; 7]; 2];

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

#[inline]
fn next128(seed: &mut u64) -> PositionKey {
    PositionKey {
        z0: splitmix64(seed),
        z1: splitmix64(seed),
    }
}

#[inline]
fn splitmix64(x: &mut u64) -> u64 {
    *x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// 1手ぶん進めた鍵を作る。**盤を舐め直さない。**
///
/// 鍵は XOR の積なので、変わった項だけ XOR し直せば
/// [`key_from_partial_position`] と同じ値になる。1手で変わるのは高々5つ。
///
/// | 指し手 | 変わる項 |
/// | --- | --- |
/// | `Normal` | 動いた駒を `from` から落とす / 置いた駒を `to` に入れる / 取った駒を `to` から落とす + 取った側の持駒を1つ増やす / 手番 |
/// | `Drop` | 打った駒を `to` に入れる / 打った側の持駒を1つ減らす / 手番 |
///
/// **`pos` は指す前の局面。** `make_move` を呼ぶ前に渡すこと。
///
/// # 読めない形は `None` を返す
///
/// `from` に駒がいない、成れない駒を成る、持駒が0枚なのに打つ、といった
/// `make_move` が `None` を返す形では、こちらも `None` を返して**呼び手を
/// フル計算へ落とす**。黙って違う鍵を作ると、**索引に入る値が静かに壊れる** —
/// 検索が当たらなくなるだけで、エラーも警告も出ない。
///
/// 持駒の枚数の頭打ち（`min(HAND_MAX - 1)`）はフル計算と同じにしてある。
/// ずらすと同じ局面から別の鍵が出る。
pub fn advance_key(key: PositionKey, pos: &PartialPosition, mv: Move) -> Option<PositionKey> {
    let tbl = ZOBRIST.get_or_init(ZobristTable::new);
    let mut key = key;

    // 手番。古い色を落として新しい色を入れる
    let mover = pos.side_to_move();
    key.xor_assign(tbl.side[cidx(mover)]);
    key.xor_assign(tbl.side[cidx(mover.flip())]);

    match mv {
        Move::Normal { from, to, promote } => {
            let piece = pos.piece_at(from)?;
            if piece.color() != mover {
                return None;
            }
            let placed = if promote { piece.promote()? } else { piece };

            // 取った駒があれば、盤から落として持駒を1つ進める
            if let Some(taken) = pos.piece_at(to) {
                if taken.color() == mover {
                    return None;
                }
                key.xor_assign(key_for_piece_on_square(tbl, taken, to));

                // 成駒は成る前の駒として持駒に入る（`make_move` と同じ）
                let kind = taken.piece_kind();
                let obtained = kind.unpromote().unwrap_or(kind);
                key.xor_assign(hand_step(tbl, pos, mover, obtained, 1)?);
            }

            key.xor_assign(key_for_piece_on_square(tbl, piece, from));
            key.xor_assign(key_for_piece_on_square(tbl, placed, to));
        }
        Move::Drop { piece, to } => {
            if piece.color() != mover {
                return None;
            }
            // 成駒は打てない（`make_move` が弾く）
            if piece.unpromote().is_some() {
                return None;
            }
            if pos.piece_at(to).is_some() {
                return None;
            }
            key.xor_assign(hand_step(tbl, pos, mover, piece.piece_kind(), -1)?);
            key.xor_assign(key_for_piece_on_square(tbl, piece, to));
        }
    }

    Some(key)
}

/// 持駒の枚数が1つ動いたぶんの差分。**古い枚数を落として新しい枚数を入れる。**
///
/// 枚数そのものを鍵に持っているので、増減は「2つの項の入れ替え」になる。
#[inline]
fn hand_step(
    tbl: &ZobristTable,
    pos: &PartialPosition,
    color: Color,
    kind: PieceKind,
    delta: i8,
) -> Option<PositionKey> {
    // 持駒に出ない駒種（玉・成駒）は表を持たない。
    // `make_move` は成駒を成る前に戻してから入れるので、ここに来るのは7種のはず
    let hk = HAND_KINDS.iter().position(|k| *k == kind)?;

    let before = pos.hand_of_a_player(color).count(kind)? as i16;

    // `shogi_core` の `Hand::added` は `wrapping_add` なので **255 の次は 0**。
    // 頭打ちで数えるこちらは 255 も 256 も同じ枠に落として差分を打ち消すので、
    // フル計算が `0` を採るのに差分は「変わらない」と答えて**鍵が食い違う**。
    // 枚数を検査する経路が無く（`jkf::Hand` の欄は `u8` なので `.jkf` が
    // `"KA":255` を名乗れる）、盤から来る値ではないので折り返しは実際に届く。
    // 諦めてフル計算に落とす — 呼び手はそのために `None` を見ている
    if before >= i16::from(u8::MAX) && delta > 0 {
        return None;
    }

    let after = before + i16::from(delta);
    if after < 0 {
        return None;
    }

    // 頭打ちはフル計算と同じ位置で掛ける
    let clamp = |n: i16| (n as usize).min(HAND_MAX - 1);
    let mut k = tbl.hand[cidx(color)][hk][clamp(before)];
    k.xor_assign(tbl.hand[cidx(color)][hk][clamp(after)]);
    Some(k)
}

/// PartialPosition から SFEN3 相当の PositionKey を作る（フル計算）
pub fn key_from_partial_position(pos: &PartialPosition) -> PositionKey {
    let tbl = ZOBRIST.get_or_init(ZobristTable::new);

    let mut key = PositionKey::ZERO;

    // 手番
    key.xor_assign(tbl.side[cidx(pos.side_to_move())]);

    // 盤上の駒
    for sq in Square::all() {
        if let Some(piece) = pos.piece_at(sq) {
            key.xor_assign(key_for_piece_on_square(tbl, piece, sq));
        }
    }

    // 持ち駒（先手/後手）
    key.xor_assign(key_for_hand(
        tbl,
        Color::Black,
        pos.hand_of_a_player(Color::Black),
    ));
    key.xor_assign(key_for_hand(
        tbl,
        Color::White,
        pos.hand_of_a_player(Color::White),
    ));

    key
}

#[inline]
fn key_for_piece_on_square(tbl: &ZobristTable, piece: Piece, sq: Square) -> PositionKey {
    let (pk, c) = piece.to_parts();
    // PieceKind::array_index() が 0..13 を返す想定
    let pk_idx = pk.array_index();
    let sq_idx = sq.array_index();
    tbl.board[cidx(c)][pk_idx][sq_idx]
}

#[inline]
fn key_for_hand(tbl: &ZobristTable, color: Color, hand: Hand) -> PositionKey {
    let mut k = PositionKey::ZERO;

    for (hk, pk) in HAND_KINDS.iter().enumerate() {
        let cnt = hand.count(*pk).unwrap_or(0) as usize;
        let cnt = cnt.min(HAND_MAX - 1);
        k.xor_assign(tbl.hand[cidx(color)][hk][cnt]);
    }

    k
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::position_apply::{apply_node_action, ApplyStatus};
    use crate::search::traverse::NodeAction;
    use shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;

    /// 棋譜を1本歩いて、差分とフル計算が**全ノードで一致する**ことを見る。
    ///
    /// 一致しないと、同じ棋譜から別の `PositionKey` が出る。索引の値が
    /// 静かに変わるだけなので、**検索が当たらなくなること以外に症状が無い**。
    fn walk_and_compare(label: &str, jkf: &JsonKifuFormat) -> usize {
        let mut pos = crate::search::initial_position::initial_partial_position(jkf)
            .unwrap_or_else(|e| panic!("{label}: 初期局面が作れない: {e}"));
        let mut key = key_from_partial_position(&pos);
        assert_eq!(key, key_from_partial_position(&pos), "{label}: 初期局面");

        let mut checked = 0usize;
        for (i, node) in jkf.moves.iter().enumerate().skip(1) {
            let Some(m) = node.move_ else {
                // special / None のノードは局面を動かさない
                continue;
            };
            let before = pos.clone();
            let action = NodeAction::Move(m);
            let Ok(ApplyStatus::Applied) = apply_node_action(&mut pos, action) else {
                break;
            };

            let mv = crate::search::position_apply::jkf_move_to_core_move(m)
                .unwrap_or_else(|e| panic!("{label}: {i}手目を core の手にできない: {e}"));
            let stepped = advance_key(key, &before, mv)
                .unwrap_or_else(|| panic!("{label}: {i}手目で差分が None を返した"));
            let full = key_from_partial_position(&pos);
            assert_eq!(stepped, full, "{label}: {i}手目で差分とフル計算がずれた");

            key = full;
            checked += 1;
        }
        checked
    }

    fn parse(text: &str) -> JsonKifuFormat {
        shogi_kifu_converter_obsshogi::parser::parse_kif_str(text).expect("題材の KIF が読めること")
    }

    /// 手合割15種すべてで一致する。
    ///
    /// **初期局面が違えば持駒も盤も違う。** 平手だけで測ると、
    /// 落とした駒のぶんの項がずれても気付けない。
    #[test]
    fn every_handicap_steps_the_same_as_a_full_recompute() {
        use crate::search::test_kifu::{one_move_kif, HANDICAPS};

        for h in HANDICAPS.iter().chain(std::iter::once(&"平手")) {
            let jkf = parse(&one_move_kif(h));
            assert!(walk_and_compare(h, &jkf) > 0, "{h}: 1手も見ていない");
        }
    }

    /// 1手で変わりうる項を全部通す。
    ///
    /// **取る / 成る / 打つ / 成駒を取る**は、それぞれ差分の別の腕を通る。
    /// どれかを落とすと、その形の棋譜だけが静かに別の鍵になる。
    #[test]
    fn capture_promotion_and_drop_all_step_the_same() {
        // 角交換から角を打ち合う。成る・取る・打つ・成駒を取るが全部出る
        let text = "手合割：平手\n\
手数----指手---------消費時間--\n   \
1 ７六歩(77)   ( 0:01/00:00:01)\n   \
2 ３四歩(33)   ( 0:01/00:00:02)\n   \
3 ２二角成(88)   ( 0:01/00:00:03)\n   \
4 同　銀(31)   ( 0:01/00:00:04)\n   \
5 ８八銀(79)   ( 0:01/00:00:05)\n   \
6 ３三銀(22)   ( 0:01/00:00:06)\n   \
7 ５五角打   ( 0:01/00:00:07)\n";
        let jkf = parse(text);
        let n = walk_and_compare("capture-promote-drop", &jkf);
        assert!(n >= 5, "題材が短すぎる: {n}手しか見ていない");
    }

    /// 持駒が `u8` の上限にいるとき、差分は答えずにフル計算へ譲る。
    ///
    /// `shogi_core` の `Hand::added` は `wrapping_add` なので **255 の次は 0**。
    /// 頭打ちで数える差分は 255 も 256 も同じ枠に落として打ち消すので、
    /// 答えると**フル計算と違う鍵**になる。枚数を検査する経路は無く、
    /// `jkf::Hand` の欄は `u8` なので `.jkf` が `"KA":255` を名乗れる。
    ///
    /// **`walk_and_compare` では届かない。** あちらは KIF を読んで歩くので、
    /// 持駒が 255 枚になる局面を作れない。ここは `hand_step` を直に見る。
    #[test]
    fn a_hand_at_the_byte_limit_falls_back_to_a_full_recompute() {
        use shogi_core::{Color, Hand, PartialPosition, PieceKind};

        let tbl = ZOBRIST.get_or_init(ZobristTable::new);
        let mut pos = PartialPosition::startpos();

        // 上限の1つ下までは差分が答える。境界がずれたらここが落ちる
        let mut hand = Hand::default();
        for _ in 0..u8::MAX - 1 {
            hand = hand.added(PieceKind::Bishop).expect("持てること");
        }
        *pos.hand_of_a_player_mut(Color::Black) = hand;
        assert!(
            hand_step(tbl, &pos, Color::Black, PieceKind::Bishop, 1).is_some(),
            "上限の1つ下で差分が諦めた"
        );

        // 上限では諦める。答えると `wrapping_add` で 0 に戻る側とずれる
        let hand = hand.added(PieceKind::Bishop).expect("持てること");
        *pos.hand_of_a_player_mut(Color::Black) = hand;
        assert_eq!(
            hand.count(PieceKind::Bishop),
            Some(u8::MAX),
            "題材が上限に届いていない"
        );
        assert!(
            hand_step(tbl, &pos, Color::Black, PieceKind::Bishop, 1).is_none(),
            "上限で差分が答えてしまった"
        );

        // 減る側は折り返さないので、上限にいても答えてよい
        assert!(
            hand_step(tbl, &pos, Color::Black, PieceKind::Bishop, -1).is_some(),
            "減る側まで諦めた"
        );
    }
}
