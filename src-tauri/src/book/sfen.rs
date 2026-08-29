use crate::book::error::{BookError, BookErrorCode};

/// 平手初期局面の定跡キー。`startpos` を引かれたときの展開先。
const HIRATE_KEY: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -";

/// 定跡を引くためのキーに直す。
///
/// 定跡は同じ局面を手数違いで別項目にしてはいけないので、キーから手数を落とす。
/// `position` / `sfen` の前置きと `startpos` も、USI 文字列をそのまま渡せるように吸収する。
pub fn normalize_sfen(input: &str) -> Result<String, BookError> {
    let mut tokens = input.split_whitespace().peekable();

    if tokens.peek() == Some(&"position") {
        tokens.next();
    }

    if tokens.peek() == Some(&"startpos") {
        return Ok(HIRATE_KEY.to_string());
    }

    if tokens.peek() == Some(&"sfen") {
        tokens.next();
    }

    let invalid = |reason: &str| {
        BookError::new(
            BookErrorCode::InvalidSfen,
            format!("{reason}: {}", input.trim()),
        )
    };

    let board = tokens.next().ok_or_else(|| invalid("局面が空"))?;
    let side = tokens.next().ok_or_else(|| invalid("手番が無い"))?;
    let hands = tokens.next().ok_or_else(|| invalid("持駒が無い"))?;

    if side != "b" && side != "w" {
        return Err(invalid("手番が b でも w でもない"));
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

    /// `startpos moves 7g7f` を渡されても、初期局面のキーになる。
    #[test]
    fn ignores_the_moves_suffix_of_startpos() {
        assert_eq!(
            normalize_sfen("position startpos moves 7g7f").unwrap(),
            HIRATE_KEY
        );
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
