//! 盤面の綴りを1つに揃える。
//!
//! 同じ盤面が違う綴りで書けると、鍵が一致せずに「載っていない」と読まれる。
//! 空きの連なりは1つの数にまとめ、段の数と各段の列の合計を数える。

use std::fmt::Write;

use super::counts::PieceCounts;

/// 盤面を検査し、空きマスの綴りを畳んで返す。
///
/// `4k22` と `4k4` は同じ盤面なので、畳まないと同じ局面が2つのキーになる。
pub(super) fn normalize_board(board: &str, counts: &mut PieceCounts) -> Result<String, String> {
    let ranks: Vec<&str> = board.split('/').collect();
    if ranks.len() != 9 {
        return Err(format!("盤面が9段ではない（{}段）", ranks.len()));
    }

    let mut out = String::with_capacity(board.len());

    for (i, rank) in ranks.iter().enumerate() {
        if i > 0 {
            out.push('/');
        }

        let mut files = 0u32;
        let mut empty = 0u32;
        let mut chars = rank.chars();

        while let Some(c) = chars.next() {
            match c {
                '1'..='9' => {
                    empty += c.to_digit(10).expect("1-9 は必ず数字");
                    files += c.to_digit(10).expect("1-9 は必ず数字");
                    continue;
                }
                '+' => {
                    let promoted = chars
                        .next()
                        .ok_or_else(|| format!("{}段目の + の後ろに駒が無い", i + 1))?;
                    // 金と玉は成れないので、+ の後ろに来たら綴りが壊れている。
                    if matches!(promoted.to_ascii_uppercase(), 'G' | 'K') {
                        return Err(format!("{}段目に成れない駒 +{promoted} がある", i + 1));
                    }
                    counts
                        .add(promoted)
                        .map_err(|reason| format!("{}段目に{reason}", i + 1))?;
                    flush_empty(&mut out, &mut empty);
                    out.push('+');
                    out.push(promoted);
                    files += 1;
                }
                _ => {
                    counts
                        .add(c)
                        .map_err(|reason| format!("{}段目に{reason}", i + 1))?;
                    flush_empty(&mut out, &mut empty);
                    out.push(c);
                    files += 1;
                }
            }
        }

        flush_empty(&mut out, &mut empty);

        if files != 9 {
            return Err(format!("{}段目の列数が9ではない（{files}）", i + 1));
        }
    }

    Ok(out)
}

/// 溜めた空きマスを10進で書き出す。
///
/// 段の列数が9かを見るのは呼び出し側で、それはこの関数を呼んだ後なので、
/// ここには 9 を超える値も来る（`"99"` という段など）。1桁を前提にしないこと。
/// **確保しない。** `to_string()` は毎回ヒープを取り、呼ばれる回数は盤の空きマスの
/// run の数（局面あたり実測 17 回）。実物の定跡（225 万局面）では 3,800 万回の
/// 短命な確保になる。
fn flush_empty(out: &mut String, empty: &mut u32) {
    if *empty > 0 {
        // `String` への `write!` は失敗しない
        let _ = write!(out, "{empty}");
        *empty = 0;
    }
}
