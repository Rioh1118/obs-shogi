use crate::book::error::{BookError, BookErrorCode};

/// 平手初期局面の定跡キー。`startpos` を引かれたときの展開先。
const HIRATE_KEY: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -";

/// 盤上に置ける駒。`+` を前置すると成駒になる（金と玉は成れない）。
const BOARD_PIECES: &str = "PLNSGKBR";

/// 持駒になりうる駒を、キーに書く順で並べたもの。
///
/// 同じ持駒が別の綴りで来ると別のキーになってしまうので、この順に畳んで書き直す。
const HAND_PIECES: [char; 7] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

/// 定跡を引くためのキーに直す。
///
/// 定跡は同じ局面を手数違いで別項目にしてはいけないので、キーから手数を落とす。
/// `position` / `sfen` の前置きと `startpos` は書き方の揺れなので吸収する。
///
/// 指し手列は解釈しない。`moves` が付いた USI の position 文字列は拒否する。
/// 局面を進めるのは呼び出し側の責務で、進めた結果の SFEN を渡すこと。
///
/// 盤面と持駒は書式を検査する。`lookup` は未収録の局面に空の `Vec` を返す約束なので、
/// 壊れた局面を素通しすると「定跡に載っていない」と見分けが付かなくなる。
///
/// 定跡ファイル側のキーもこの関数を通して作ること。持駒の並びをここで畳んでいるので、
/// 片方だけ生の綴りを使うと同じ局面が一致しない。
pub fn normalize_sfen(input: &str) -> Result<String, BookError> {
    let invalid = |reason: &str| {
        BookError::new(
            BookErrorCode::InvalidSfen,
            format!("{reason}: {}", input.trim()),
        )
    };

    // 指し手を適用せずに黙って捨てると、進めたはずの局面に初期局面の候補手が返る。
    // エラーにならないので呼び出し側が誤りに気づけない。
    let reject_rest = |tokens: &mut dyn Iterator<Item = &str>| -> Result<(), BookError> {
        match tokens.next() {
            None => Ok(()),
            Some("moves") => Err(invalid(
                "指し手列付きの局面は定跡キーにできない。進めた局面の SFEN を渡すこと",
            )),
            Some(extra) => Err(invalid(&format!(
                "局面の後ろに余分なトークン {extra} がある"
            ))),
        }
    };

    let mut tokens = input.split_whitespace().peekable();

    if tokens.peek() == Some(&"position") {
        tokens.next();
    }

    if tokens.peek() == Some(&"startpos") {
        tokens.next();
        reject_rest(&mut tokens)?;
        return Ok(HIRATE_KEY.to_string());
    }

    if tokens.peek() == Some(&"sfen") {
        tokens.next();
    }

    let board = tokens.next().ok_or_else(|| invalid("局面が空"))?;
    let side = tokens.next().ok_or_else(|| invalid("手番が無い"))?;
    let hands = tokens.next().ok_or_else(|| invalid("持駒が無い"))?;

    if side != "b" && side != "w" {
        return Err(invalid("手番が b でも w でもない"));
    }

    // 手数は落とすが、書かれているなら数値であることは見る。
    // ここを素通しにすると `moves` の検査が手数の位置で素通りする。
    if let Some(ply) = tokens.next() {
        if ply == "moves" {
            return Err(invalid(
                "指し手列付きの局面は定跡キーにできない。進めた局面の SFEN を渡すこと",
            ));
        }
        if ply.parse::<u32>().is_err() {
            return Err(invalid(&format!("手数が数値でない: {ply}")));
        }
        reject_rest(&mut tokens)?;
    }

    validate_board(board).map_err(|reason| invalid(&reason))?;
    let hands = normalize_hands(hands).map_err(|reason| invalid(&reason))?;

    Ok(format!("{board} {side} {hands}"))
}

/// 9段 × 各段9列ぶんが埋まっていることを見る。
fn validate_board(board: &str) -> Result<(), String> {
    let ranks: Vec<&str> = board.split('/').collect();
    if ranks.len() != 9 {
        return Err(format!("盤面が9段ではない（{}段）", ranks.len()));
    }

    for (i, rank) in ranks.iter().enumerate() {
        let mut files = 0u32;
        let mut chars = rank.chars();

        while let Some(c) = chars.next() {
            match c {
                '1'..='9' => files += c.to_digit(10).expect("1-9 は必ず数字"),
                '+' => {
                    let promoted = chars
                        .next()
                        .ok_or_else(|| format!("{}段目の + の後ろに駒が無い", i + 1))?;
                    // 金と玉は成れないので、+ の後ろに来たら綴りが壊れている。
                    if !BOARD_PIECES.contains(promoted.to_ascii_uppercase())
                        || matches!(promoted.to_ascii_uppercase(), 'G' | 'K')
                    {
                        return Err(format!("{}段目に成れない駒 +{promoted} がある", i + 1));
                    }
                    files += 1;
                }
                _ if BOARD_PIECES.contains(c.to_ascii_uppercase()) => files += 1,
                _ => return Err(format!("{}段目に駒でない文字 {c} がある", i + 1)),
            }
        }

        if files != 9 {
            return Err(format!("{}段目の列数が9ではない（{files}）", i + 1));
        }
    }

    Ok(())
}

/// 持駒を検査し、`HAND_PIECES` の順（先手を先）に畳んで書き直す。
fn normalize_hands(hands: &str) -> Result<String, String> {
    if hands == "-" {
        return Ok("-".to_string());
    }

    // [先手, 後手] × HAND_PIECES の枚数。
    let mut counts = [[0u32; HAND_PIECES.len()]; 2];
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

        // 歩は最大18枚なので、それを超える綴りは壊れている。
        let count = if digits.is_empty() {
            1
        } else {
            digits.parse::<u32>().unwrap_or(u32::MAX)
        };
        if count == 0 || count > 18 {
            return Err(format!("持駒の枚数が範囲外（{digits}）"));
        }

        let piece = chars
            .next()
            .ok_or_else(|| format!("持駒の枚数 {digits} に駒が続いていない"))?;
        let index = HAND_PIECES
            .iter()
            .position(|p| *p == piece.to_ascii_uppercase())
            .ok_or_else(|| format!("持駒にできない文字 {piece} がある"))?;

        let side = usize::from(piece.is_ascii_lowercase());
        counts[side][index] += count;
    }

    let mut out = String::new();
    for (side, row) in counts.iter().enumerate() {
        for (index, &count) in row.iter().enumerate() {
            if count == 0 {
                continue;
            }
            if count > 1 {
                out.push_str(&count.to_string());
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

#[cfg(test)]
mod tests {
    use super::*;

    const HIRATE_SFEN: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

    #[test]
    fn drops_the_move_number() {
        assert_eq!(normalize_sfen(HIRATE_SFEN).unwrap(), HIRATE_KEY);
    }

    /// 同じ局面が手数違いで別キーにならないこと。定跡が引けるかを決める性質。
    #[test]
    fn same_position_with_different_move_number_maps_to_one_key() {
        let early = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2";
        let late = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 40";
        assert_eq!(
            normalize_sfen(early).unwrap(),
            normalize_sfen(late).unwrap()
        );
    }

    #[test]
    fn accepts_a_missing_move_number() {
        let without_ply = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -";
        assert_eq!(normalize_sfen(without_ply).unwrap(), HIRATE_KEY);
    }

    #[test]
    fn strips_the_usi_prefixes() {
        for prefix in ["sfen ", "position sfen "] {
            let input = format!("{prefix}{HIRATE_SFEN}");
            assert_eq!(
                normalize_sfen(&input).unwrap(),
                HIRATE_KEY,
                "prefix={prefix}"
            );
        }
    }

    #[test]
    fn expands_startpos() {
        for input in ["startpos", "position startpos", "  startpos  "] {
            assert_eq!(normalize_sfen(input).unwrap(), HIRATE_KEY, "input={input}");
        }
    }

    /// 指し手列を適用しないので受け取らない。黙って初期局面のキーを返すと、
    /// 進めたはずの局面に別の局面の候補手が返る。
    #[test]
    fn rejects_a_position_with_moves() {
        for input in [
            "position startpos moves 7g7f",
            "startpos moves 7g7f 3c3d",
            &format!("position sfen {HIRATE_SFEN} moves 7g7f"),
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - moves 7g7f",
        ] {
            let err = normalize_sfen(input).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "input={input:?}");
            assert!(
                err.message.contains("指し手列"),
                "message={:?} input={input:?}",
                err.message
            );
        }
    }

    #[test]
    fn rejects_trailing_tokens_after_the_position() {
        for input in ["startpos extra", &format!("{HIRATE_SFEN} extra")] {
            let err = normalize_sfen(input).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "input={input:?}");
        }
    }

    #[test]
    fn rejects_a_non_numeric_move_number() {
        let err = normalize_sfen("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - x")
            .unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidSfen);
    }

    #[test]
    fn keeps_the_hand_field() {
        let with_hands = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b P2p 1";
        assert!(normalize_sfen(with_hands).unwrap().ends_with(" b P2p"));
    }

    fn hirate_with_hands(hands: &str) -> String {
        format!("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b {hands} 1")
    }

    /// 同じ持駒が別の綴りで来ても同じキーになること。片方だけ生の綴りを使うと
    /// 同じ局面が一致しない。
    #[test]
    fn hand_spelling_does_not_change_the_key() {
        let canonical = normalize_sfen(&hirate_with_hands("2P2p")).unwrap();
        for spelling in ["2p2P", "PP2p", "2Ppp", "P1P2p"] {
            assert_eq!(
                normalize_sfen(&hirate_with_hands(spelling)).unwrap(),
                canonical,
                "spelling={spelling}"
            );
        }
    }

    #[test]
    fn hands_are_written_in_a_fixed_order() {
        // 先手（大文字）が先、その中は R B G S N L P の順。
        let key = normalize_sfen(&hirate_with_hands("pLbR")).unwrap();
        assert!(key.ends_with(" b RLbp"), "key={key}");
    }

    #[test]
    fn rejects_a_broken_hand_field() {
        for hands in ["K", "k", "0P", "19P", "2", "-P", "P-", "+P", "x"] {
            let err = normalize_sfen(&hirate_with_hands(hands)).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "hands={hands}");
        }
    }

    #[test]
    fn rejects_a_broken_board() {
        for board in [
            // 8段しかない
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1",
            // 段の列数が9にならない
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNLL",
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/8",
            // 駒でない文字
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNX",
            // 金と玉は成れない
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/+GNSGKGSN1",
            // + の後ろに駒が無い
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSN+",
        ] {
            let err = normalize_sfen(&format!("{board} b - 1")).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "board={board}");
        }
    }

    #[test]
    fn accepts_promoted_pieces_on_the_board() {
        let board = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5+R1/LNSGKGSNL";
        assert!(normalize_sfen(&format!("{board} b - 1")).is_ok());
    }

    #[test]
    fn rejects_input_that_is_not_a_position() {
        for input in ["", "   ", "sfen", "lnsgkgsnl b", "lnsgkgsnl x - 1"] {
            let err = normalize_sfen(input).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "input={input:?}");
        }
    }
}
