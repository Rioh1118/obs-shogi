use super::position_key::{key_from_partial_position, PositionKey};
use shogi_core::{Color, Hand, PartialPosition, Piece, PieceKind, Square};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SfenParseError {
    #[error("empty sfen")]
    Empty,

    #[error("unsupported format")]
    Unsupported,

    #[error("invalid sfen: {0}")]
    Invalid(String),

    #[error("invalid square: x={x}, y={y}")]
    InvalidSquare { x: u8, y: u8 },

    #[error("invalid piece: {0}")]
    InvalidPiece(String),

    #[error("invalid hand piece: {0}")]
    InvalidHandPiece(char),

    #[error("invalid ply: {0}")]
    InvalidPly(String),

    #[error("invalid hand construction")]
    InvalidHand,
}

pub fn partial_position_from_sfen(input: &str) -> Result<PartialPosition, SfenParseError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(SfenParseError::Empty);
    }

    let mut tokens: Vec<&str> = s.split_whitespace().collect();
    if tokens.first().copied() == Some("position") {
        tokens.remove(0);
    }

    if tokens.first().copied() == Some("startpos") {
        return Ok(PartialPosition::startpos());
    }

    if tokens.first().copied() == Some("sfen") {
        tokens.remove(0);
    }

    if tokens.len() < 4 {
        return Err(SfenParseError::Unsupported);
    }

    let board = tokens[0];
    let side = tokens[1];
    let hand = tokens[2];
    let ply = tokens[3];

    let mut pos = PartialPosition::empty();

    // 手番
    let stm = match side {
        "b" => Color::Black,
        "w" => Color::White,
        _ => return Err(SfenParseError::Invalid(format!("side token: {side}"))),
    };
    pos.side_to_move_set(stm);

    // 盤面
    parse_board_into(&mut pos, board)?;

    // 持駒
    parse_hands_into(&mut pos, hand)?;

    // 手数（SFEN3では無視してもいいが、構造として入れておく）
    let ply_u16: u16 = ply
        .parse()
        .map_err(|_| SfenParseError::InvalidPly(ply.to_string()))?;
    if ply_u16 == 0 || !pos.ply_set(ply_u16) {
        return Err(SfenParseError::InvalidPly(ply.to_string()));
    }

    Ok(pos)
}

/// SFEN入力から直接 PositionKey を作る
pub fn position_key_from_sfen(input: &str) -> Result<PositionKey, SfenParseError> {
    let pos = partial_position_from_sfen(input)?;
    Ok(key_from_partial_position(&pos))
}

// ---------------------------
// internal helpers
// ---------------------------

fn parse_board_into(pos: &mut PartialPosition, board: &str) -> Result<(), SfenParseError> {
    let ranks: Vec<&str> = board.split('/').collect();
    if ranks.len() != 9 {
        return Err(SfenParseError::Invalid(format!(
            "board ranks must be 9: {board}"
        )));
    }

    for (r_idx, r_str) in ranks.iter().enumerate() {
        let y = (r_idx as u8) + 1; // rank: 1(a) .. 9(i)
        let mut file: i32 = 9; // SFENは各段で 9..1 の順に書かれる

        let mut it = r_str.chars().peekable();
        while let Some(ch) = it.next() {
            if ch.is_ascii_digit() {
                let n = ch.to_digit(10).unwrap() as i32;
                file -= n;
                continue;
            }

            let (promoted, pch) = if ch == '+' {
                let next = it
                    .next()
                    .ok_or_else(|| SfenParseError::Invalid("dangling '+'".to_string()))?;
                (true, next)
            } else {
                (false, ch)
            };

            if file < 1 {
                return Err(SfenParseError::Invalid(format!(
                    "file underflow in rank {y}: {r_str}"
                )));
            }

            let (color, pk) = piecekind_from_sfen_letter(pch, promoted)?;
            let sq = Square::new(file as u8, y)
                .ok_or(SfenParseError::InvalidSquare { x: file as u8, y })?;

            pos.piece_set(sq, Some(Piece::new(pk, color)));
            file -= 1;
        }

        if file != 0 {
            return Err(SfenParseError::Invalid(format!(
                "rank {y} does not sum to 9: {r_str}"
            )));
        }
    }

    Ok(())
}

fn parse_hands_into(pos: &mut PartialPosition, hand: &str) -> Result<(), SfenParseError> {
    if hand == "-" {
        return Ok(());
    }

    let mut hb = Hand::new();
    let mut hw = Hand::new();

    let mut num: usize = 0;
    for ch in hand.chars() {
        if ch.is_ascii_digit() {
            num = num * 10 + (ch.to_digit(10).unwrap() as usize);
            continue;
        }

        if ch == '+' {
            return Err(SfenParseError::Invalid("hand contains '+'".to_string()));
        }

        let cnt = if num == 0 { 1 } else { num };
        num = 0;

        let (color, pk) = hand_piecekind_from_letter(ch)?;
        match color {
            Color::Black => hb = add_n(hb, pk, cnt)?,
            Color::White => hw = add_n(hw, pk, cnt)?,
        }
    }

    if num != 0 {
        return Err(SfenParseError::Invalid(format!(
            "dangling number in hand: {hand}"
        )));
    }

    *pos.hand_of_a_player_mut(Color::Black) = hb;
    *pos.hand_of_a_player_mut(Color::White) = hw;

    Ok(())
}

fn add_n(mut h: Hand, pk: PieceKind, n: usize) -> Result<Hand, SfenParseError> {
    for _ in 0..n {
        h = h.added(pk).ok_or(SfenParseError::InvalidHand)?;
    }
    Ok(h)
}

fn piecekind_from_sfen_letter(
    ch: char,
    promoted: bool,
) -> Result<(Color, PieceKind), SfenParseError> {
    let color = if ch.is_ascii_uppercase() {
        Color::Black
    } else if ch.is_ascii_lowercase() {
        Color::White
    } else {
        return Err(SfenParseError::InvalidPiece(ch.to_string()));
    };

    let up = ch.to_ascii_uppercase();
    let pk = match (up, promoted) {
        ('P', false) => PieceKind::Pawn,
        ('L', false) => PieceKind::Lance,
        ('N', false) => PieceKind::Knight,
        ('S', false) => PieceKind::Silver,
        ('G', false) => PieceKind::Gold,
        ('B', false) => PieceKind::Bishop,
        ('R', false) => PieceKind::Rook,
        ('K', false) => PieceKind::King,

        ('P', true) => PieceKind::ProPawn,
        ('L', true) => PieceKind::ProLance,
        ('N', true) => PieceKind::ProKnight,
        ('S', true) => PieceKind::ProSilver,
        ('B', true) => PieceKind::ProBishop,
        ('R', true) => PieceKind::ProRook,

        // 金/玉は成れない（SFENとしても通常出てこない）
        ('G', true) | ('K', true) => return Err(SfenParseError::InvalidPiece(format!("+{ch}"))),

        _ => return Err(SfenParseError::InvalidPiece(ch.to_string())),
    };

    Ok((color, pk))
}

fn hand_piecekind_from_letter(ch: char) -> Result<(Color, PieceKind), SfenParseError> {
    let color = if ch.is_ascii_uppercase() {
        Color::Black
    } else if ch.is_ascii_lowercase() {
        Color::White
    } else {
        return Err(SfenParseError::InvalidHandPiece(ch));
    };

    let up = ch.to_ascii_uppercase();
    let pk = match up {
        'P' => PieceKind::Pawn,
        'L' => PieceKind::Lance,
        'N' => PieceKind::Knight,
        'S' => PieceKind::Silver,
        'G' => PieceKind::Gold,
        'B' => PieceKind::Bishop,
        'R' => PieceKind::Rook,
        // hand に King は来ない
        _ => return Err(SfenParseError::InvalidHandPiece(ch)),
    };

    Ok((color, pk))
}
