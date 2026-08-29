use crate::book::error::{BookError, BookErrorCode};

/// 平手初期局面の定跡キー。`startpos` を引かれたときの展開先。
const HIRATE_KEY: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -";

/// 定跡を引くためのキーに直す。
///
/// 定跡は同じ局面を手数違いで別項目にしてはいけないので、キーから手数を落とす。
/// `position` / `sfen` の前置きと `startpos` は書き方の揺れなので吸収する。
///
/// 指し手列は解釈しない。`moves` が付いた USI の position 文字列は拒否する。
/// 局面を進めるのは呼び出し側の責務で、進めた結果の SFEN を渡すこと。
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

    Ok(format!("{board} {side} {hands}"))
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

    #[test]
    fn rejects_input_that_is_not_a_position() {
        for input in ["", "   ", "sfen", "lnsgkgsnl b", "lnsgkgsnl x - 1"] {
            let err = normalize_sfen(input).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "input={input:?}");
        }
    }
}
