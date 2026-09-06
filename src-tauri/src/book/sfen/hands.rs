//! 持駒の綴りを1つに揃える。
//!
//! 盤と違い、持駒は**書く順番が決まっていない**。順序が違うだけの同じ持駒が
//! 別の鍵になると、その局面は永久に引けない。だから [`HAND_PIECES`] の順に並べ直す。

use std::fmt::Write;

use super::counts::hand_count::HandCount;
use super::counts::{PieceCounts, HAND_PIECES};

/// 持駒を検査し、`HAND_PIECES` の順（先手を先）に畳んで書き直す。
pub(super) fn normalize_hands(hands: &str, counts: &mut PieceCounts) -> Result<String, String> {
    if hands == "-" {
        return Ok("-".to_string());
    }

    // [先手, 後手] × HAND_PIECES の枚数。書き出す順に畳むために持つ。
    let mut hand_counts = [[0u32; HAND_PIECES.len()]; 2];
    let mut chars = hands.chars().peekable();

    while chars.peek().is_some() {
        let mut digits = String::new();
        while let Some(&c) = chars.peek() {
            if !c.is_ascii_digit() {
                break;
            }
            digits.push(c);
            chars.next();
        }

        // 駒種ごとの上限は、盤上と合わせて数え終わってから
        // PieceCounts::validate が見る。ここで見るのは1トークンの桁だけ。
        let count = HandCount::parse(&digits)?;

        let piece = chars
            .next()
            .ok_or_else(|| format!("持駒の枚数 {digits} に駒が続いていない"))?;
        // 玉は持駒にならないので HAND_PIECES に無い。ここで弾く。
        // PieceCounts は盤上の玉を数えるために K を受け付けるので、
        // この検査を外すと持駒の玉が通る。
        let index = HAND_PIECES
            .iter()
            .position(|p| *p == piece.to_ascii_uppercase())
            .ok_or_else(|| format!("持駒にできない文字 {piece} がある"))?;

        counts.add_many(piece, count)?;

        let side = usize::from(piece.is_ascii_lowercase());
        hand_counts[side][index] += count.get();
    }

    let mut out = String::new();
    for (side, row) in hand_counts.iter().enumerate() {
        for (index, &count) in row.iter().enumerate() {
            if count == 0 {
                continue;
            }
            if count > 1 {
                // `to_string()` は毎回ヒープを取る。書き先は既にあるので要らない
                let _ = write!(out, "{count}");
            }
            let piece = HAND_PIECES[index];
            out.push(if side == 0 {
                piece
            } else {
                piece.to_ascii_lowercase()
            });
        }
    }

    Ok(out)
}
