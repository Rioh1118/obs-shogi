use std::sync::OnceLock;

use shogi_core::{Color, Hand, PartialPosition, Piece, PieceKind, Square};

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
            for pk in 0..14 {
                for sq in 0..81 {
                    board[c][pk][sq] = next128(&mut seed);
                }
            }
            for hk in 0..7 {
                for n in 0..HAND_MAX {
                    hand[c][hk][n] = next128(&mut seed);
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
