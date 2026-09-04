//! 局面を綴った文字列を読んで [`PartialPosition`] にする。
//!
//! **`shogi_core` に読む側は無い。** 局面を綴りに直す側は持っているが、
//! 綴りから局面に戻す口が無いので、解く経路は手で書くしかない。
//!
//! **受理するのは SFEN より広い。** 先頭の `position` / `startpos` / `sfen` を
//! 剥がすので、エンジンへ送る USI の行がそのまま通る。`book` 側にもう1本
//! 別の受理集合があり、どちらへ寄せるかは #236。

use crate::search::position::position_key::{key_from_partial_position, PositionKey};
use shogi_core::{Color, Hand, PartialPosition, Piece, PieceKind, Square};
use thiserror::Error;

/// 綴りが局面として読めなかった理由。
///
/// **`InvalidSquare` は返らない。** 升は必ず範囲内で作るため（#391）。
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

/// 綴りを局面にする。
///
/// [`PartialPosition`] は**指し手の列を持たない局面**（`shogi_core` の名前）。
/// 盤・手番・持駒はあるが手順が無いので、千日手のような手順を要る判定はできない。
/// 索引が持つのは局面そのものなので、こちらで足りる。
///
/// 綴りは空白区切りの4つ。位置で意味が決まる。
///
/// ```text
/// lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1
/// └───────────────── 盤 ──────────────────┘ │ │ │
///                                        手番 │ 手数
///                                        持駒 ┘
/// ```
///
/// **`src/` からの呼び手はいない。** 製品経路は [`position_key_from_sfen`] だけを通る。
/// `pub` なのは `benches/search_bench.rs` が綴りを解く時間だけを測るため。
pub fn partial_position_from_sfen(input: &str) -> Result<PartialPosition, SfenParseError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(SfenParseError::Empty);
    }

    // USI の `position` 行がそのまま来てもいいように、局面の綴りに辿り着くまで
    // 前置きを剥がす。`startpos` はそれ自体が局面なので、ここで確定して返る
    let mut tokens: Vec<&str> = s.split_whitespace().collect();
    if tokens.first().copied() == Some("position") {
        tokens.remove(0);
    }

    // **この枝は手数を検査しない。** 綴り方によって `ply` の扱いが変わる（#236）
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

    // 升も持駒も空の盤から始めて、綴りに書いてある駒だけを置いていく。
    // `PartialPosition` に一括で流し込む口が無いので、組み立ては `&mut` で回す
    let mut pos = PartialPosition::empty();

    let stm = match side {
        "b" => Color::Black,
        "w" => Color::White,
        _ => return Err(SfenParseError::Invalid(format!("side token: {side}"))),
    };
    pos.side_to_move_set(stm);

    parse_board_into(&mut pos, board)?;
    parse_hands_into(&mut pos, hand)?;

    // **手数は鍵に入らない。** `key_from_partial_position` が読むのは手番・盤・持駒だけ。
    // つまりここで弾く `0` は、通していれば同じ鍵が出た入力。受理集合は #236
    let ply_u16: u16 = ply
        .parse()
        .map_err(|_| SfenParseError::InvalidPly(ply.to_string()))?;
    if ply_u16 == 0 || !pos.ply_set(ply_u16) {
        return Err(SfenParseError::InvalidPly(ply.to_string()));
    }

    Ok(pos)
}

/// 綴りから索引の鍵を作る。**製品経路が通るのはこちら。**
pub fn position_key_from_sfen(input: &str) -> Result<PositionKey, SfenParseError> {
    let pos = partial_position_from_sfen(input)?;
    Ok(key_from_partial_position(&pos))
}

// ---------------------------
// internal helpers
// ---------------------------

/// 盤の綴りを読んで `pos` に駒を置く。
///
/// 綴りは `/` で**段**（横の並び）を区切り、上の段から順に9つ。各段の中は
/// **筋**（縦の並び）を 9 から 1 へ向かって書く。数字は空き升の数、
/// `+` は次の1文字が成駒であることを表す。
fn parse_board_into(pos: &mut PartialPosition, board: &str) -> Result<(), SfenParseError> {
    let ranks: Vec<&str> = board.split('/').collect();
    if ranks.len() != 9 {
        return Err(SfenParseError::Invalid(format!(
            "board ranks must be 9: {board}"
        )));
    }

    for (r_idx, r_str) in ranks.iter().enumerate() {
        let y = (r_idx as u8) + 1; // 段: 1(a) .. 9(i)
        let mut file: i32 = 9; // 筋: 各段は 9 から 1 へ書かれる

        let mut it = r_str.chars();
        while let Some(ch) = it.next() {
            if ch.is_ascii_digit() {
                let n = ch.to_digit(10).expect("is_ascii_digit checked") as i32;
                file -= n;
                continue;
            }

            // `+` は単独では駒にならない。次の1文字と組で1つの成駒を表す
            let (promoted, pch) = if ch == '+' {
                let next = it
                    .next()
                    .ok_or_else(|| SfenParseError::Invalid("dangling '+'".to_string()))?;
                (true, next)
            } else {
                (false, ch)
            };

            // 数字が多すぎて筋を使い切った形。ここで弾くので、以降 `Square::new` は必ず成功する
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

/// 持駒の綴りを読んで `pos` に持たせる。
///
/// 駒の文字の**前**に枚数を書く（`2P` は歩2枚）。数字が無ければ1枚。
/// 持駒が無い局面は `-` の1文字。
fn parse_hands_into(pos: &mut PartialPosition, hand: &str) -> Result<(), SfenParseError> {
    if hand == "-" {
        return Ok(());
    }

    let mut hb = Hand::new();
    let mut hw = Hand::new();

    let mut num: usize = 0;
    for ch in hand.chars() {
        if ch.is_ascii_digit() {
            num = num * 10 + (ch.to_digit(10).expect("is_ascii_digit checked") as usize);
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

/// 盤上の駒1文字を読む。**大文字が先手、小文字が後手。**
///
/// `promoted` は直前に `+` があったか。金と玉は成れないので、`+` が付いた形は弾く。
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

/// 持駒の駒1文字を読む。盤上と違い**成駒と玉は来ない**ので、受けるのは7種だけ。
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
