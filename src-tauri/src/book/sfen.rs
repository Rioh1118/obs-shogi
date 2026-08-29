use crate::book::error::{BookError, BookErrorCode};

/// 正規化を通した定跡のキー。
///
/// 生の SFEN と混ざると、手数や持駒の綴りの違いで黙って引けなくなる。中身を
/// private にして [`to_book_key`] 以外から作れなくすることで、その取り違えを
/// コンパイル時に止める。
///
/// `search` の `PositionKey`（Zobrist ハッシュ）とは別物。こちらは文字列で、
/// 定跡ファイルに書かれている綴りと突き合わせるためにある。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct BookKey(String);

impl BookKey {
    // TODO(#91): reader がファイルの綴りと突き合わせるときに使う。
    // それまで呼び手はテストしか居ない。
    #[cfg(test)]
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// 平手初期局面の定跡キー。`startpos` を引かれたときの展開先。
const HIRATE_BOOK_KEY: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -";

/// 駒種と、40枚の駒箱に入っている数。玉は先後1枚ずつ。
///
/// 盤上と持駒を通して数え、この数を超えたら綴りが壊れていると判断する。
const PIECE_LIMITS: [(char, u32); 8] = [
    ('P', 18),
    ('L', 4),
    ('N', 4),
    ('S', 4),
    ('G', 4),
    ('B', 2),
    ('R', 2),
    ('K', 2),
];

/// 持駒になりうる駒を、キーに書く順で並べたもの。玉は持駒にならない。
///
/// 同じ持駒が別の綴りで来ると別のキーになるので、この順に畳んで書き直す。
///
/// **この並びは外部仕様に従属する。** ファイル上を二分探索する reader は、
/// ファイルに書かれた綴りとキーを直接比較するため、並びがやねうら王の書き出す
/// 持駒順とバイト単位で一致していなければ全ての lookup が空を返す。
/// 現在の並びは `research/findings/L3-book-solved.md` の記録に基づくもので、
/// やねうら王本体の `Position::sfen()` までは確認できていない。
/// #91 で実物の定跡を fixture に置くとき、そこで突き合わせること。
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
/// 綴りの揺れ（空きマスの数字の分割、持駒の並び）は畳む。畳んだ結果をもう一度
/// 通しても同じキーになる。
///
/// メモリに展開する reader は、定跡ファイル側のキーもこの関数を通すこと。
/// ファイル上を二分探索する reader は通せない（通すと探索の前提である
/// ソート順が壊れる）ので、代わりに [`HAND_PIECES`] の並びと出力の書式が
/// ファイルの綴りと一致していることに依存する。
pub(crate) fn to_book_key(input: &str) -> Result<BookKey, BookError> {
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
        return Ok(BookKey(HIRATE_BOOK_KEY.to_string()));
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

    // 盤上と持駒を通して数えるので、駒数の検査は両方を読んでから行う。
    let mut counts = PieceCounts::default();
    let board = normalize_board(board, &mut counts).map_err(|reason| invalid(&reason))?;
    let hands = normalize_hands(hands, &mut counts).map_err(|reason| invalid(&reason))?;
    counts.validate().map_err(|reason| invalid(&reason))?;

    Ok(BookKey(format!("{board} {side} {hands}")))
}

/// 駒種ごとの枚数。盤上と持駒を通して数える。
#[derive(Default)]
struct PieceCounts {
    /// [先手, 後手] × PIECE_LIMITS
    by_side: [[u32; PIECE_LIMITS.len()]; 2],
}

impl PieceCounts {
    /// 大文字なら先手、小文字なら後手として1枚数える。成駒は元の駒種で数える。
    fn add(&mut self, piece: char) -> Result<(), String> {
        let index = PIECE_LIMITS
            .iter()
            .position(|(kind, _)| *kind == piece.to_ascii_uppercase())
            .ok_or_else(|| format!("駒でない文字 {piece} がある"))?;

        let side = usize::from(piece.is_ascii_lowercase());
        self.by_side[side][index] += 1;
        Ok(())
    }

    fn add_many(&mut self, piece: char, count: u32) -> Result<(), String> {
        for _ in 0..count {
            self.add(piece)?;
        }
        Ok(())
    }

    /// 駒箱に入っている数を超えていないか見る。
    ///
    /// 超えている局面は将棋に存在しないので、どの定跡にも載っていない。
    /// 素通しすると、壊れた入力が「定跡に載っていない」と見分けが付かなくなる。
    fn validate(&self) -> Result<(), String> {
        for (index, (kind, limit)) in PIECE_LIMITS.iter().enumerate() {
            let total = self.by_side[0][index] + self.by_side[1][index];
            if total > *limit {
                return Err(format!("{kind} が{total}枚ある（多くても{limit}枚）"));
            }

            // 玉だけは先後それぞれ1枚。合計2枚の検査では 0 対 2 を弾けない。
            if *kind == 'K' && (self.by_side[0][index] > 1 || self.by_side[1][index] > 1) {
                return Err("同じ側に玉が2枚以上ある".to_string());
            }
        }

        Ok(())
    }
}

/// 盤面を検査し、空きマスの綴りを畳んで返す。
///
/// `4k22` と `4k4` は同じ盤面なので、畳まないと同じ局面が2つのキーになる。
fn normalize_board(board: &str, counts: &mut PieceCounts) -> Result<String, String> {
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

/// 溜めた空きマスを1つの数字として書き出す。9マスまでしか溜まらない。
fn flush_empty(out: &mut String, empty: &mut u32) {
    if *empty > 0 {
        out.push_str(&empty.to_string());
        *empty = 0;
    }
}

/// 持駒を検査し、`HAND_PIECES` の順（先手を先）に畳んで書き直す。
fn normalize_hands(hands: &str, counts: &mut PieceCounts) -> Result<String, String> {
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

        // 1トークンの桁だけをここで見る。駒種ごとの上限は、盤上と合わせて
        // 数え終わってから PieceCounts::validate が見る。
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

        // 玉は持駒にならないので HAND_PIECES には無く、ここで弾かれる。
        counts.add_many(piece, count)?;

        let side = usize::from(piece.is_ascii_lowercase());
        hand_counts[side][index] += count;
    }

    let mut out = String::new();
    for (side, row) in hand_counts.iter().enumerate() {
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

    /// 期待値は文字列で書きたいので、BookKey を剥がして返す。
    fn key(input: &str) -> String {
        to_book_key(input).unwrap().0
    }

    const HIRATE_SFEN: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

    #[test]
    fn drops_the_move_number() {
        assert_eq!(key(HIRATE_SFEN), HIRATE_BOOK_KEY);
    }

    /// 同じ局面が手数違いで別キーにならないこと。定跡が引けるかを決める性質。
    #[test]
    fn same_position_with_different_move_number_maps_to_one_key() {
        let early = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2";
        let late = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 40";
        assert_eq!(key(early), key(late));
    }

    #[test]
    fn accepts_a_missing_move_number() {
        let without_ply = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -";
        assert_eq!(key(without_ply), HIRATE_BOOK_KEY);
    }

    #[test]
    fn strips_the_usi_prefixes() {
        for prefix in ["sfen ", "position sfen "] {
            let input = format!("{prefix}{HIRATE_SFEN}");
            assert_eq!(key(&input), HIRATE_BOOK_KEY, "prefix={prefix}");
        }
    }

    #[test]
    fn expands_startpos() {
        for input in ["startpos", "position startpos", "  startpos  "] {
            assert_eq!(key(input), HIRATE_BOOK_KEY, "input={input}");
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
            let err = to_book_key(input).unwrap_err();
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
            let err = to_book_key(input).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "input={input:?}");
        }
    }

    #[test]
    fn rejects_a_non_numeric_move_number() {
        let err = to_book_key("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - x")
            .unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidSfen);
    }

    #[test]
    fn keeps_the_hand_field() {
        assert!(key(&bare_with_hands("P2p")).ends_with(" b P2p"));
    }

    /// 玉だけの盤面。持駒の綴りを試すのに使う。平手のままだと盤上の駒と
    /// 合わせて駒箱の数を超えてしまう。
    const BARE_BOARD: &str = "4k4/9/9/9/9/9/9/9/4K4";

    fn bare_with_hands(hands: &str) -> String {
        format!("{BARE_BOARD} b {hands} 1")
    }

    /// 同じ持駒が別の綴りで来ても同じキーになること。片方だけ生の綴りを使うと
    /// 同じ局面が一致しない。
    #[test]
    fn hand_spelling_does_not_change_the_key() {
        let canonical = key(&bare_with_hands("2P2p"));
        for spelling in ["2p2P", "PP2p", "2Ppp", "P1P2p"] {
            assert_eq!(
                key(&bare_with_hands(spelling)),
                canonical,
                "spelling={spelling}"
            );
        }
    }

    #[test]
    fn hands_are_written_in_a_fixed_order() {
        // 先手（大文字）が先、その中は R B G S N L P の順。
        let folded = key(&bare_with_hands("pLbR"));
        assert!(folded.ends_with(" b RLbp"), "folded={folded}");
    }

    #[test]
    fn rejects_a_broken_hand_field() {
        for hands in ["K", "k", "0P", "19P", "2", "-P", "P-", "+P", "x"] {
            let err = to_book_key(&bare_with_hands(hands)).unwrap_err();
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
            let err = to_book_key(&format!("{board} b - 1")).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "board={board}");
        }
    }

    /// 駒箱に入っていない枚数の局面は将棋に存在しないので、どの定跡にも載っていない。
    /// 素通しすると「定跡に載っていない」と見分けが付かなくなる。
    #[test]
    fn rejects_more_pieces_than_the_set_holds() {
        // 1トークンでは上限内でも、合算すると超える
        for hands in ["18P1P", "9P9P1P", "3R", "3r", "2R1r", "5G"] {
            let err = to_book_key(&bare_with_hands(hands)).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "hands={hands}");
        }

        // 盤上と持駒の通し。平手には既に歩が18枚ある
        let err = to_book_key("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b P 1")
            .unwrap_err();
        assert_eq!(err.code, BookErrorCode::InvalidSfen);

        for board in [
            // 玉が9枚
            "KKKKKKKKK/9/9/9/9/9/9/9/9",
            // 同じ側に玉が2枚
            "3kk4/9/9/9/9/9/9/9/4K4",
            // 歩が81枚
            "PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP",
        ] {
            let err = to_book_key(&format!("{board} b - 1")).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "board={board}");
        }
    }

    /// 空きマスの綴りが分かれていても同じキーになること。畳まないと同じ局面が
    /// 2つのキーになり、片方でしか引けない。
    #[test]
    fn an_empty_square_run_has_one_spelling() {
        let split = key("4k22/9/9/9/9/9/9/9/4K4 b - 1");
        let folded = key("4k4/9/9/9/9/9/9/9/4K4 b - 1");
        assert_eq!(split, folded);
        assert!(folded.starts_with("4k4/"), "folded={folded}");

        assert_eq!(
            key("4k4/45/9/9/9/9/9/9/4K4 b - 1"),
            key("4k4/9/9/9/9/9/9/9/4K4 b - 1")
        );
    }

    /// キーをもう一度通しても同じキーであること。畳み残しがあるとここで壊れる。
    #[test]
    fn a_key_is_stable_when_normalized_again() {
        for input in [
            HIRATE_SFEN,
            "startpos",
            "4k22/9/9/9/9/9/9/9/4K4 b - 1",
            &bare_with_hands("pLbR"),
            &bare_with_hands("18P"),
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5+R1/LNSGKGSNL w - 40",
        ] {
            let once = to_book_key(input).unwrap();
            let twice = to_book_key(once.as_str()).unwrap();
            assert_eq!(once, twice, "input={input}");
        }
    }

    #[test]
    fn accepts_promoted_pieces_on_the_board() {
        let board = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5+R1/LNSGKGSNL";
        assert!(to_book_key(&format!("{board} b - 1")).is_ok());
    }

    #[test]
    fn rejects_input_that_is_not_a_position() {
        for input in ["", "   ", "sfen", "lnsgkgsnl b", "lnsgkgsnl x - 1"] {
            let err = to_book_key(input).unwrap_err();
            assert_eq!(err.code, BookErrorCode::InvalidSfen, "input={input:?}");
        }
    }
}
