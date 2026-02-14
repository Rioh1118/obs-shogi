use thiserror::Error;

use shogi_core::{Color as CoreColor, Hand as CoreHand, PartialPosition, Piece, PieceKind, Square};
use shogi_kifu_converter::jkf::{
    Color as JkfColor, Hand as JkfHand, Initial, JsonKifuFormat, Kind as JkfKind,
    Piece as JkfPiece, Preset, StateFormat,
};

pub type Jkf = JsonKifuFormat;

#[derive(Debug, Error)]
pub enum InitialPosError {
    #[error("unsupported preset without explicit data: {0:?}")]
    UnsupportedPreset(Preset),

    #[error("invalid square: x={x}, y={y}")]
    InvalidSquare { x: u8, y: u8 },

    #[error("unsupported piece kind in JKF: {0:?}")]
    UnsupportedKind(JkfKind),

    #[error("invalid hand construction")]
    InvalidHand,
}

/// JKFから「開始局面」を作る（方針：平手 or dataありのみ対応）
pub fn initial_partial_position(jkf: &Jkf) -> Result<PartialPosition, InitialPosError> {
    match jkf.initial {
        None => Ok(PartialPosition::startpos()),
        Some(init) => initial_from_initial(init),
    }
}

fn initial_from_initial(init: Initial) -> Result<PartialPosition, InitialPosError> {
    match (init.preset, init.data) {
        (Preset::PresetHirate, None) => Ok(PartialPosition::startpos()),
        (_preset, Some(state)) => partial_from_state(state),
        (preset, None) => Err(InitialPosError::UnsupportedPreset(preset)),
    }
}

fn partial_from_state(state: StateFormat) -> Result<PartialPosition, InitialPosError> {
    let mut pos = PartialPosition::empty();

    // 手番
    pos.side_to_move_set(to_core_color(state.color));

    // 盤面：JKFのboardは board[x-1][y-1] 前提で読む
    for x in 1..=9u8 {
        for y in 1..=9u8 {
            let sq = Square::new(x, y).ok_or(InitialPosError::InvalidSquare { x, y })?;

            let jp: JkfPiece = state.board[(x - 1) as usize][(y - 1) as usize];
            let piece = jkf_piece_to_core_piece(jp)?;
            pos.piece_set(sq, piece);
        }
    }

    // 持ち駒（JKF: hands[0]=先手, hands[1]=後手 として扱う）
    set_hand(&mut pos, CoreColor::Black, state.hands[0])?;
    set_hand(&mut pos, CoreColor::White, state.hands[1])?;

    Ok(pos)
}

fn set_hand(
    pos: &mut PartialPosition,
    color: CoreColor,
    h: JkfHand,
) -> Result<(), InitialPosError> {
    let mut hand = CoreHand::new();

    hand = add_n(hand, PieceKind::Pawn, h.FU)?;
    hand = add_n(hand, PieceKind::Lance, h.KY)?;
    hand = add_n(hand, PieceKind::Knight, h.KE)?;
    hand = add_n(hand, PieceKind::Silver, h.GI)?;
    hand = add_n(hand, PieceKind::Gold, h.KI)?;
    hand = add_n(hand, PieceKind::Bishop, h.KA)?;
    hand = add_n(hand, PieceKind::Rook, h.HI)?;

    *pos.hand_of_a_player_mut(color) = hand;
    Ok(())
}

// Hand::added を回す（Hand APIはこれが基本）:contentReference[oaicite:1]{index=1}
fn add_n(mut hand: CoreHand, pk: PieceKind, n: u8) -> Result<CoreHand, InitialPosError> {
    for _ in 0..n {
        hand = hand.added(pk).ok_or(InitialPosError::InvalidHand)?;
    }
    Ok(hand)
}

fn jkf_piece_to_core_piece(p: JkfPiece) -> Result<Option<Piece>, InitialPosError> {
    match (p.color, p.kind) {
        (Some(c), Some(k)) => {
            let pk = to_piece_kind(k)?;
            Ok(Some(Piece::new(pk, to_core_color(c))))
        }
        (None, None) => Ok(None),
        // “片方だけSome” は基本不正データなので、方針次第でエラーにしてもOK
        _ => Ok(None),
    }
}

fn to_piece_kind(k: JkfKind) -> Result<PieceKind, InitialPosError> {
    Ok(match k {
        JkfKind::FU => PieceKind::Pawn,
        JkfKind::KY => PieceKind::Lance,
        JkfKind::KE => PieceKind::Knight,
        JkfKind::GI => PieceKind::Silver,
        JkfKind::KI => PieceKind::Gold,
        JkfKind::KA => PieceKind::Bishop,
        JkfKind::HI => PieceKind::Rook,
        JkfKind::OU => PieceKind::King,
        JkfKind::TO => PieceKind::ProPawn,
        JkfKind::NY => PieceKind::ProLance,
        JkfKind::NK => PieceKind::ProKnight,
        JkfKind::NG => PieceKind::ProSilver,
        JkfKind::UM => PieceKind::ProBishop,
        JkfKind::RY => PieceKind::ProRook,
    })
}

fn to_core_color(c: JkfColor) -> CoreColor {
    match c {
        JkfColor::Black => CoreColor::Black,
        JkfColor::White => CoreColor::White,
    }
}
