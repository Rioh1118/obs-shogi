//! 局面を綴った文字列を読んで [`PartialPosition`] にする。
//!
//! **`shogi_core` に読む側は無い。** 局面を綴りに直す側は持っているが、
//! 綴りから局面に戻す口が無いので、解く経路は手で書くしかない。
//!
//! **受理するのは SFEN より広い。** 先頭の `position` / `startpos` / `sfen` を
//! 剥がすので、エンジンへ送る USI の行がそのまま通る。
//!
//! **定跡側にもう1本の受理集合がある**（`book/sfen/key.rs` の `to_book_key`）。
//! そちらは手数を任意にして落とし、盤と持駒を合わせて駒数を数えて弾く ——
//! こちらは4トークンと `ply >= 1` を要求する代わりに駒種ごとの上限を見ない。
//! **統合しないこと。** 出す物が別で（Zobrist の鍵 / 定跡ファイルの綴りと
//! 突き合わせる正規化済み文字列）、失敗の型も別（内部語 / 利用者に届く復帰操作つき）。
//! どちらへ寄せるかは #236。

use crate::search::message::for_screen;
use crate::search::position::position_key::{key_from_partial_position, PositionKey};
use shogi_core::{Color, Hand, PartialPosition, Piece, PieceKind, Square};
use thiserror::Error;

/// 綴りが局面として読めなかった理由。
///
/// **`InvalidSquare` は返らない。** 升は必ず範囲内で作るため（#391）。
///
/// **入力から取った値には2つとも掛ける。選ぶものではない。** この文言は
/// そのまま `SearchErrorPayload` に載る（描かれ方はその doc）。
///
/// 1. **必ず `{:?}` で出す。** 刈るだけでは足りない —— 受け皿は制御文字を空白に
///    落とすので、`"\u{0}"` が来ると `invalid piece: ` と見えて**どの字が悪いのかが
///    画面から消える**。`{:?}` なら字を名指せる
/// 2. **長さに上限が無いものは、加えて刈る**（`Invalid` / `InvalidPly` は
///    `invalid` / `invalid_ply` を通す）。載せるのは空白で区切った1トークンで、
///    綴り側に上限が無い。`InvalidPiece` / `InvalidHandPiece` が載せるのは1〜2文字
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

    /// 盤の綴りの中の、駒として読めなかった綴り。`+` が付いていればそれも含む。
    ///
    /// **`{:?}` で出す。** 綴りは棋譜でもファイル名でもなく利用者が保存した
    /// JSON の値なので、制御文字が入りうる。素で出すと `invalid piece: ` と
    /// 見えて、**どの字が悪いのかが画面から消える**。
    #[error("invalid piece: {0:?}")]
    InvalidPiece(String),

    /// 持駒の綴りの中の、駒として読めなかった1文字。`InvalidPiece` と同じ理由で `{:?}`。
    #[error("invalid hand piece: {0:?}")]
    InvalidHandPiece(char),

    #[error("invalid ply: {0}")]
    InvalidPly(String),

    /// 1つの駒種の持駒が多すぎる。上限は `MAX_HAND_COUNT`（歩の18枚）。
    ///
    /// **枚数は言わない。** 綴りは同じ駒種を何度でも書けて（`18P18P`）、
    /// 桁も上限の1つ上で頭打ちにするので、**数えた値が綴りのどこにも無い**
    /// ことがある（`18P99999999P` は 37 になる）。
    #[error("too many pieces in hand: {kind:?} (max {MAX_HAND_COUNT})")]
    InvalidHand { kind: PieceKind },
}

/// 1つの駒種の持駒として受ける最大の枚数。
///
/// **鍵が枚数として区別できる上限に合わせている**（`zobrist` が持つ）。
/// これより多い枚数を受けると、鍵の上では同じ枠に落ちて別の局面が同じ鍵になる。
///
/// 7種の上限のうち最も緩いもの（歩の18枚）なので、**駒種ごとの上限は見ない** —
/// `18R` は通る。
const MAX_HAND_COUNT: u32 = super::zobrist::MAX_REPRESENTABLE_HAND_COUNT;

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
        _ => return Err(invalid(format_args!("side token: {side:?}"))),
    };
    pos.side_to_move_set(stm);

    parse_board_into(&mut pos, board)?;
    parse_hands_into(&mut pos, hand)?;

    // **手数は鍵に入らない。** `key_from_partial_position` が読むのは手番・盤・持駒だけ。
    // つまりここで弾く `0` は、通していれば同じ鍵が出た入力。受理集合は #236
    let ply_u16: u16 = ply.parse().map_err(|_| invalid_ply(ply))?;
    if ply_u16 == 0 || !pos.ply_set(ply_u16) {
        return Err(invalid_ply(ply));
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

/// 入力の綴りを埋めた [`SfenParseError::Invalid`] を作る。
///
/// **渡す書式では、入力から取った値を `{:?}` で書くこと。** ここは `Arguments` を
/// 受けるだけなので強制できない。素で書くと、制御文字が空白に潰れて
/// 何も名指ししない文言になる（enum の doc に基準がある）。
///
/// **組みながら刈る。** `String` を先に作って渡すと、刈る対象が先に出来上がる。
/// `format_args!` のまま受けると、上限を超えたぶんは組み立てられない。
///
/// **ここで刈るのは確保を頭打ちにするため。** 画面に出るのは `query_service` が
/// `SfenParseError` の `Display` を**もう一度**刈った値で、`#[error]` の前置きぶん
/// だけ短くなる。だからこの段で `followed_by` のような「上限の外の一文」を
/// 足さないこと——2度目で落ちる。
fn invalid(detail: std::fmt::Arguments<'_>) -> SfenParseError {
    SfenParseError::Invalid(for_screen(&detail).to_string())
}

/// 手数の綴りを載せた [`SfenParseError::InvalidPly`] を作る。
///
/// **手数の欄も空白区切りの1トークンなので、長さの上限は綴り側に無い。**
/// `"1"` を期待する欄だが、そう書いてあるとは限らないから弾いている。
fn invalid_ply(ply: &str) -> SfenParseError {
    SfenParseError::InvalidPly(for_screen(&format_args!("{ply:?}")).to_string())
}

/// 盤の綴りを読んで `pos` に駒を置く。
///
/// 綴りは `/` で**段**（横の並び）を区切り、上の段から順に9つ。各段の中は
/// **筋**（縦の並び）を 9 から 1 へ向かって書く。数字は空き升の数、
/// `+` は次の1文字が成駒であることを表す。
fn parse_board_into(pos: &mut PartialPosition, board: &str) -> Result<(), SfenParseError> {
    let ranks: Vec<&str> = board.split('/').collect();
    if ranks.len() != 9 {
        return Err(invalid(format_args!("board ranks must be 9: {board:?}")));
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
                    .ok_or_else(|| invalid(format_args!("dangling '+'")))?;
                (true, next)
            } else {
                (false, ch)
            };

            // 数字が多すぎて筋を使い切った形。ここで弾くので、以降 `Square::new` は必ず成功する
            if file < 1 {
                return Err(invalid(format_args!(
                    "file underflow in rank {y}: {r_str:?}"
                )));
            }

            let (color, pk) = piecekind_from_sfen_letter(pch, promoted)?;
            let sq = Square::new(file as u8, y)
                .ok_or(SfenParseError::InvalidSquare { x: file as u8, y })?;

            pos.piece_set(sq, Some(Piece::new(pk, color)));
            file -= 1;
        }

        if file != 0 {
            return Err(invalid(format_args!(
                "rank {y} does not sum to 9: {r_str:?}"
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

    let mut num: u32 = 0;
    for ch in hand.chars() {
        if ch.is_ascii_digit() {
            // **ここでは弾かず、上限の1つ上で頭打ちにする。** 弾くと駒種が未確定の
            // まま `Err` を作ることになり、文言が「どの駒が多すぎるか」を言えない。
            // 頭打ちにするのは `num * 10` が `u32` を溢れるのを止めるため
            num = (num * 10 + ch.to_digit(10).expect("is_ascii_digit checked"))
                .min(MAX_HAND_COUNT + 1);
            continue;
        }

        if ch == '+' {
            return Err(invalid(format_args!("hand contains '+'")));
        }

        let cnt = if num == 0 { 1 } else { num };
        num = 0;

        let (color, pk) = hand_piecekind_from_letter(ch)?;
        match color {
            Color::Black => hb = add_n(hb, pk, cnt)?,
            Color::White => hw = add_n(hw, pk, cnt)?,
        }
    }

    // 数字だけで終わる綴り（`"18"`）は `add_n` に届かないので、ここでしか止められない
    if num != 0 {
        return Err(invalid(format_args!("hand ends with a number")));
    }

    *pos.hand_of_a_player_mut(Color::Black) = hb;
    *pos.hand_of_a_player_mut(Color::White) = hw;

    Ok(())
}

/// 同じ駒種を `n` 枚足す。**足した後の累計**が [`MAX_HAND_COUNT`] を超えたら弾く。
///
/// **1回ぶんの `n` を見るだけでは門番にならない。** 同じ駒種は綴りに何度でも書けて
/// （`18P18P`）、`Hand::added` は持駒に出る7種なら枚数を見ずに必ず `Some` を返す
/// （`wrapping_add` なので 255 の次は 0）。累計を見ないと、書いた枚数と
/// 読まれた枚数が食い違ったまま通る。
fn add_n(mut h: Hand, pk: PieceKind, n: u32) -> Result<Hand, SfenParseError> {
    // `count` も `added` も同じ条件（持駒に出る7種か）で `None` を返す。
    // 片方を既定値ですり替えると、もう片方の `expect` を守っている前提が読めなくなる
    let before = u32::from(h.count(pk).expect("持駒に出る7種なので枚数が数えられる"));
    if before + n > MAX_HAND_COUNT {
        return Err(SfenParseError::InvalidHand { kind: pk });
    }
    for _ in 0..n {
        h = h.added(pk).expect("持駒に出る7種なので必ず持てる");
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
    // **綴りに書いてあった通りに名指す。** `+` を落とすと `+9` が「`9` が読めない」に
    // なり、段の中では合法な文字を探しに行かせることになる
    let as_written = || {
        if promoted {
            format!("+{ch}")
        } else {
            ch.to_string()
        }
    };

    let color = if ch.is_ascii_uppercase() {
        Color::Black
    } else if ch.is_ascii_lowercase() {
        Color::White
    } else {
        return Err(SfenParseError::InvalidPiece(as_written()));
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

        // 金/玉は成れない（SFENとしても通常出てこない）ので、`_` の腕がそのまま弾く
        _ => return Err(SfenParseError::InvalidPiece(as_written())),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// **読めなかった綴りを、そのまま文言に載せない。**
    ///
    /// 綴りは空白で区切った1トークンなので、盤・手番・手数のどの欄も
    /// **長さの上限を持たない**（読ませる経路は保存された研究局面の JSON）。
    /// この文言が画面でどう描かれるかは `SearchErrorPayload::message` の doc。
    #[test]
    fn a_huge_token_does_not_end_up_in_the_message() {
        let hirate = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL";
        // **制御文字は先頭に置く。** 上限より後ろに置くと刈られて到達せず、
        // 置換を丸ごと消しても下の assert が通ってしまう
        let huge = format!("\0{}", "9".repeat(200_000));
        // 筋を使い切るには数字が先に要る。制御文字はその直後に置く
        let underflow = format!("99\0{}", "9".repeat(200_000));
        let digits = "1".repeat(200_000);

        for (name, sfen, head) in [
            (
                "盤の欄",
                format!("{huge} b - 1"),
                "invalid sfen: board ranks must be 9: \"\\0999",
            ),
            (
                "手番の欄",
                format!("{hirate} {huge} - 1"),
                "invalid sfen: side token: \"\\0999",
            ),
            (
                "手数の欄",
                format!("{hirate} b - {huge}"),
                "invalid ply: \"\\0999",
            ),
            (
                "筋を使い切った段",
                format!("{underflow}P/9/9/9/9/9/9/9/9 b - 1"),
                "invalid sfen: file underflow in rank 1: \"99\\099",
            ),
            (
                "9筋に足りない段",
                format!("{digits}/9/9/9/9/9/9/9/9 b - 1"),
                "invalid sfen: rank 1 does not sum to 9: \"1111",
            ),
        ] {
            let message = partial_position_from_sfen(&sfen)
                .expect_err(name)
                .to_string();
            // **固定したい上限そのものと比べない。** `SCREEN_MESSAGE_LIMIT` を上げるだけで
            // 通ってしまい、刈り込みが効かなくなったことに気付けない
            assert!(
                message.chars().count() < 1_000,
                "{name}: 文言が刈られていない: {} 文字",
                message.chars().count()
            );
            assert!(
                !message.contains('\0'),
                "{name}: 制御文字がそのまま入っている: {message:?}"
            );
            // **短いだけでは足りない。** 何が悪いのかを名乗らない定型文に潰す変異は、
            // 長さだけを見ていると通る。診断が**文頭**にあることも同時に見る
            // （文頭に置く理由は `SearchErrorPayload::message` の doc）
            assert!(
                message.starts_with(head),
                "{name}: 何が悪いのかが文言から消えた: {message}"
            );
            assert!(
                message.ends_with('…'),
                "{name}: 刈った印が付いていない: {message}"
            );
        }
    }

    /// **駒として読めなかった綴りを、書いてあった通りに名指す。**
    ///
    /// 2つの壊れ方を1本で見る。
    ///
    /// - **制御文字が消えない。** 綴りは利用者が保存した JSON の値なので制御文字が
    ///   入りうる。素で出すと `invalid piece: ` と見えて、何を直せばよいか言えない。
    ///   刈っても直らない（受け皿は制御文字を空白にするだけ）ので `{:?}` で出している
    /// - **`+` を落とさない。** 読むのは `+` の**次**の1文字だが、`+9` で `9` だけを
    ///   名指すと、段の中では合法な `9` を探しに行かせることになる
    #[test]
    fn a_piece_that_could_not_be_read_is_named_as_written() {
        for (name, sfen, expected) in [
            // 盤の欄の1文字目。数字でも `+` でもないので駒として読みに行く
            (
                "盤の駒",
                "\u{0}nsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
                "\"\\0\"",
            ),
            // 持駒の欄。数字でも `+` でもないので駒として読みに行く
            (
                "持駒の駒",
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b \u{0} 1",
                "'\\0'",
            ),
            // **`+` を落とさない。** `9` は段の中では合法なので、`9` だけを
            // 名指すと利用者は合法な文字を探しに行く
            (
                "`+` が付いた合法な文字",
                "+9nsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
                "\"+9\"",
            ),
            // 成れない駒に `+` が付いた形
            (
                "`+` が付いた金",
                "+Gnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1",
                "\"+G\"",
            ),
        ] {
            let message = partial_position_from_sfen(sfen)
                .expect_err(name)
                .to_string();
            assert!(
                !message.contains('\u{0}'),
                "{name}: 制御文字がそのまま入っている: {message:?}"
            );
            assert!(
                message.contains(expected),
                "{name}: 綴りの通りに名指していない（{expected} が無い）: {message}"
            );
        }
    }

    /// 持駒の枚数に上限がある。**無いと綴り1本で盤が止まる。**
    ///
    /// 駒を置くのは1枚ずつのループなので、上限が無いと `999...9P` の回数だけ回る。
    /// この綴りを読むのは `query_service` の非同期タスクの中で、しかも
    /// `EVT_SEARCH_BEGIN` を出した後。返らないと画面は「検索中…」のまま残り、
    /// 取り消しも効かない（取り消しの検査はこれより後ろにしか無い）。
    ///
    /// **枚数を検査する経路は他に無い。** `shogi_core` の `Hand::added` は
    /// 持駒に出る7種なら枚数を見ずに必ず `Some` を返す。
    #[test]
    fn a_hand_count_beyond_the_limit_is_rejected_instead_of_looping() {
        let hirate = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL";

        // 歩は18枚まで持てる
        assert!(
            partial_position_from_sfen(&format!("{hirate} b 18P 1")).is_ok(),
            "上限ちょうどを弾いている"
        );

        // 19枚は弾く
        assert!(
            matches!(
                partial_position_from_sfen(&format!("{hirate} b 19P 1")),
                Err(SfenParseError::InvalidHand { .. })
            ),
            "上限を超えた枚数が通った"
        );

        // 桁は上限の1つ上で頭打ちにするので、20桁でも `num * 10` が溢れない
        assert!(
            matches!(
                partial_position_from_sfen(&format!("{hirate} b 99999999999999999999P 1")),
                Err(SfenParseError::InvalidHand { .. })
            ),
            "巨大な枚数が通った"
        );
    }

    /// **同じ駒種を何度でも書けるので、1トークンの検査では門番にならない。**
    ///
    /// `Hand::added` は持駒に出る7種なら枚数を見ずに必ず `Some` を返す。
    /// しかも `wrapping_add` なので 255 の次は 0 に戻る — 累計を見ないと、
    /// **綴りに書いた局面と読まれた局面が違う**まま通る。
    ///
    /// 36枚の方も静かに壊れる。鍵は枚数を枠へ落とすので（`zobrist::hand_count`）、
    /// 36枚は18枚と**同じ鍵**になり、盤に存在し得ない局面で検索して
    /// 別の局面の棋譜が正常なヒットとして並ぶ。
    #[test]
    fn the_same_kind_written_twice_is_counted_together() {
        let hirate = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL";

        // 合わせて36枚
        assert!(
            matches!(
                partial_position_from_sfen(&format!("{hirate} b 18P18P 1")),
                Err(SfenParseError::InvalidHand { .. })
            ),
            "同じ駒種を2度書いて上限を超えた"
        );

        // 合わせて256枚。u8 が一周して「0枚」として読まれる形
        let many = "18P".repeat(14) + "4P";
        assert!(
            matches!(
                partial_position_from_sfen(&format!("{hirate} b {many} 1")),
                Err(SfenParseError::InvalidHand { .. })
            ),
            "折り返して 0 枚になる綴りが通った"
        );

        // 分けて書いても上限までは通る
        assert!(
            partial_position_from_sfen(&format!("{hirate} b 9P9P 1")).is_ok(),
            "合計が上限以内なのに弾いている"
        );
    }

    /// **文言が、綴りに書いてある駒種を名指す。**
    ///
    /// `Err` を作るのは `add_n` だけ。桁を読む段では駒種が決まっていないので、
    /// そこで弾くと「どの駒が多すぎるか」を言えない。
    #[test]
    fn the_message_names_the_kind_that_was_written() {
        let hirate = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL";

        let msg = partial_position_from_sfen(&format!("{hirate} b 19R 1"))
            .expect_err("19枚は上限を超える")
            .to_string();
        assert!(
            msg.contains("Rook"),
            "書いていない駒種を名指している: {msg}"
        );

        // 桁は上限の1つ上で頭打ちにするので、枚数は「19」として届く
        let msg = partial_position_from_sfen(&format!("{hirate} b 99999999999999999999L 1"))
            .expect_err("巨大な枚数は上限を超える")
            .to_string();
        assert!(
            msg.contains("Lance"),
            "書いていない駒種を名指している: {msg}"
        );
    }
}
