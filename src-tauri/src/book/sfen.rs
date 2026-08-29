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
    // ファイル上を探索する reader は、これで取り出した綴りをファイルの中身と
    // 突き合わせる。#[cfg(test)] で塞ぐとその reader が書けなくなるので、
    // 呼び手がテストしか居ない間も本番ビルドに残す。
    // TODO(#91): やねうら王 .db の reader が最初の呼び手になる。
    #[allow(dead_code)]
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
///
/// 現在の並びは USI の持駒表記の慣例（飛角金銀桂香歩）に合わせたもので、
/// **一次資料とは突き合わせていない。**
// TODO(#91): 実物の定跡を fixture に置くとき、やねうら王の書き出す綴りと
// 突き合わせて確定させる。
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
/// これを直接呼ぶのはコマンド境界だけ。定跡ファイルに書かれている局面を
/// キーにするときは [`to_book_key_in_file`] を使うこと（失敗の意味が違う）。
///
/// メモリに展開する reader は、定跡ファイル側のキーも [`to_book_key_in_file`] を
/// 通すこと。ファイル上を二分探索する reader は通せない（通すと探索の前提である
/// ソート順が壊れる）ので、代わりに [`HAND_PIECES`] の並びと出力の書式が
/// ファイルの綴りと一致していることに依存する。
pub(crate) fn to_book_key(input: &str) -> Result<BookKey, BookError> {
    // 引用は発生源で打ち切る。input はコマンド境界から来る任意長の文字列で、
    // 打ち切らないと message がそのままログへ流れ、失敗1回で以前の記録が消える。
    //
    // 理由文の側も通す。入口で全体の長さを切っているので断片も 256 字以下に
    // 収まるが、`MAX_INPUT_CHARS` を緩めたときや `invalid` を経由しない理由文が
    // 増えたときに取り残さないための二重の防御。
    let invalid = |reason: &str| {
        BookError::new(
            BookErrorCode::InvalidSfen,
            format!(
                "{}: {}",
                truncate_for_message(reason),
                truncate_for_message(input.trim())
            ),
        )
    };

    // 局面として成立しうる長さを超えるものは、理由文を組み立てる前に落とす。
    // 打ち切りを断片ごとに足して回る形だと、枝が増えるたびに取り残しが出る。
    if input.chars().count() > MAX_INPUT_CHARS {
        return Err(invalid("局面として長すぎる"));
    }

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

    if let Some(ply) = tokens.next() {
        // 手数の位置に来た moves は、後ろの reject_rest まで届かないのでここで見る。
        if ply == "moves" {
            return Err(invalid(
                "指し手列付きの局面は定跡キーにできない。進めた局面の SFEN を渡すこと",
            ));
        }
        // 手数はキーから落とすが、数値でないものを黙って落とすと、書き間違えた
        // 局面が正しいキーとして通ってしまう。
        //
        // 先頭ゼロも拒否する。parse は無視するので、受け付けると手数を好きなだけ
        // 長く書けてしまい、局面の文字列に長さの上限が無くなる。
        if ply.len() > 1 && ply.starts_with('0') {
            return Err(invalid(&format!("手数に先頭ゼロがある: {ply}")));
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

/// 定跡ファイルに書かれている局面をキーにする。
///
/// 読めない行は利用者の入力の誤りではなくファイルの破損なので、`InvalidSfen`
/// ではなく `InvalidContent` にして定跡のパスと復帰操作を添える。種別だけ
/// 付け替えても、人が読むのは message なので「渡した局面が読めない」のままになる。
///
/// 元の理由は括弧に入れて残す。行そのものの打ち切りは [`to_book_key`] の中で
/// 済んでいる（`.db` の1行は、途中で切れたファイルや別形式のファイルでは
/// 数 MB になりうる）。
// TODO(#91): 最初の呼び手はやねうら王 .db の reader。行番号を添えられるように
// するかは、そこで決める。
#[allow(dead_code)]
pub(crate) fn to_book_key_in_file(line: &str, path: &str) -> Result<BookKey, BookError> {
    to_book_key(line).map_err(|err| {
        BookError::new(
            BookErrorCode::InvalidContent,
            format!(
                "定跡ファイルに読めない行がある。取得し直すか、別の定跡を開くこと（{}）",
                err.message()
            ),
        )
        .with_path(path)
    })
}

/// 局面の文字列として受け付ける長さの上限。
///
/// 盤面は `81 - 盤上の駒数 + 綴りの字数 + '/'8個` で、成れる駒を全て `+X`（2字）で
/// 書き空きマスを畳まないときが最長。駒を1枚ずつ持駒へ移すと盤面は1字縮み、
/// 持駒は1字増えるので、**盤面と持駒の合計は駒の置き方によらず 127 字**。
/// `position sfen ` の前置き・手番・10桁の手数を足して 155 字が、正当な入力の最長。
/// `a_maximally_spelled_board_is_accepted` がその長さちょうどを通している。
///
/// この計算は、冗長な綴り（持駒の枚数 `1`、先頭ゼロ）を
/// [`hand_count::HandCount::parse`] と手数の検査が拒否することに依存している。
/// 受け付けると同じ局面を好きなだけ長く書けて、上限そのものが無くなる。
///
/// 155 の 1.65 倍を取り、2 の冪へ丸めて 256。
/// これを超えるものは局面ではないので、数え上げにも理由文にも進ませない。
const MAX_INPUT_CHARS: usize = 256;

/// message に載せる引用の上限。
///
/// 「持駒が無い: <局面>」のような理由が読み取れる長さで、なおかつ失敗1件が
/// ログ（200KB でローテート）の予算を食い潰さない上限として選んだ。
const MESSAGE_EXCERPT_CHARS: usize = 120;

/// message に載せる引用を打ち切る。
fn truncate_for_message(excerpt: &str) -> String {
    let mut out: String = excerpt.chars().take(MESSAGE_EXCERPT_CHARS).collect();
    if out.chars().count() < excerpt.chars().count() {
        out.push('…');
    }
    out
}

/// 持駒の枚数を、検査を通さずに作れないようにするための囲い。
///
/// 内側のモジュールに入れるのは、タプル構造体のフィールドが**同じモジュールからは
/// 見える**ため。`normalize_hands` も `PieceCounts::add_many` も `sfen` の直下に
/// あるので、ここに置かないと `HandCount(raw)` と書けてしまい、型は何も止めない。
mod hand_count {
    /// 持駒トークン1つぶんの枚数。
    ///
    /// [`HandCount::parse`] 以外から作れない。数え上げてから検査する形に
    /// 書き換えるとコンパイルが通らない。通ってしまうと、`"4294967295P"` の1回で
    /// 数え上げのループが 42.9 億回まわり、`to_book_key` を同期に呼んでいる
    /// async ワーカが埋まる。
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(super) struct HandCount(u32);

    impl HandCount {
        /// 1トークンの枚数は、最も多い歩でも18枚。桁あふれもここへ落とす。
        ///
        /// 冗長な綴り（先頭ゼロ、枚数 `1` の明示）は拒否する。受け付けると
        /// 同じ持駒を好きなだけ長く書けてしまい、局面の文字列に長さの上限が
        /// 無くなる（`MAX_INPUT_CHARS` の根拠が成り立たなくなる）。
        pub(super) fn parse(digits: &str) -> Result<Self, String> {
            if digits == "1" {
                return Err("持駒の枚数 1 は書かない".to_string());
            }
            if digits.len() > 1 && digits.starts_with('0') {
                return Err(format!("持駒の枚数に先頭ゼロがある（{digits}）"));
            }

            let count = if digits.is_empty() {
                1
            } else {
                digits.parse::<u32>().unwrap_or(u32::MAX)
            };

            if count == 0 || count > 18 {
                return Err(format!("持駒の枚数が範囲外（{digits}）"));
            }

            Ok(Self(count))
        }

        pub(super) fn get(self) -> u32 {
            self.0
        }
    }
}

use hand_count::HandCount;

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

    fn add_many(&mut self, piece: char, count: HandCount) -> Result<(), String> {
        for _ in 0..count.get() {
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

/// 溜めた空きマスを10進で書き出す。
///
/// 段の列数が9かを見るのは呼び出し側で、それはこの関数を呼んだ後なので、
/// ここには 9 を超える値も来る（`"99"` という段など）。1桁を前提にしないこと。
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

    /// ファイルの行が読めないのは利用者の入力の誤りではない。
    /// 種別だけでなく、人が読む文面も「ファイルが壊れている」と言うこと。
    #[test]
    fn a_broken_line_in_a_file_is_reported_as_broken_content() {
        let err = to_book_key_in_file("壊れた行", "/books/a.db").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert_eq!(err.path(), Some("/books/a.db"));
        assert!(
            err.message().contains("定跡ファイル"),
            "message={}",
            err.message()
        );
        assert!(
            err.message().contains("取得し直す"),
            "message={}",
            err.message()
        );
    }

    /// 入力そのものが長い場合は、理由文を組み立てる前に落ちること。
    #[test]
    fn a_position_that_is_too_long_is_rejected_before_building_the_reason() {
        let huge = "x".repeat(100_000);

        for input in [huge.clone(), format!("{HIRATE_SFEN} {huge}")] {
            let err = to_book_key(&input).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen);
            assert!(
                err.message().contains("長すぎる"),
                "message={}",
                err.message()
            );
        }
    }

    /// 理由文に入力の断片を埋める枝を、実際に通して打ち切りを見る。
    ///
    /// 入力全体を長くすると入口の長さ検査に落ちてこの枝へ来ないので、
    /// **全体は `MAX_INPUT_CHARS` 以下のまま、1トークンだけを長くする。**
    /// 上限は絶対値で見る。`MESSAGE_EXCERPT_CHARS` から導くと、その定数を
    /// 緩めたときにテストも一緒に緩む。
    ///
    /// 長さだけを見ると、理由文と引用のどちらか一方を打ち切っただけでも通る。
    /// 打ち切りの跡（`…`）の数で、両方に効いていることを見る。
    #[test]
    fn a_long_token_is_truncated_in_the_reason() {
        const LOG_BUDGET_CHARS: usize = 512;

        // 全体が 256 字を超えない範囲で、1トークンだけを長くする
        let long_token = "x".repeat(150);
        let long_digits = "9".repeat(150);

        let inputs = [
            // 手数が数値でない → 理由文に {ply} が入る
            format!("{BARE_BOARD} b - {long_token}"),
            // 局面の後ろに余分なトークン → 理由文に {extra} が入る
            format!("{BARE_BOARD} b - 1 {long_token}"),
            // 持駒の桁 → 理由文に {digits} が入る
            format!("{BARE_BOARD} b {long_digits}P 1"),
            // 持駒の枚数に駒が続かない → 理由文に {digits} が入る。
            // 先頭ゼロで桁を伸ばす。"9" を並べると桁あふれで「範囲外」に落ちて
            // 1つ上と同じ枝になり、この枝を通らない
            format!("{BARE_BOARD} b {}1 1", "0".repeat(149)),
        ];

        for input in inputs {
            assert!(
                input.chars().count() <= MAX_INPUT_CHARS,
                "入口の検査に落ちてしまう: len={}",
                input.chars().count()
            );

            for message in [
                to_book_key(&input).unwrap_err().message(),
                to_book_key_in_file(&input, "/books/a.db")
                    .unwrap_err()
                    .message(),
            ] {
                assert!(
                    !message.contains("長すぎる"),
                    "入口の検査に落ちている: {message}"
                );
                assert!(
                    message.chars().count() <= LOG_BUDGET_CHARS,
                    "len={}",
                    message.chars().count()
                );

                // 理由文と引用の両方が打ち切られていること。`…` の数で見るのは、
                // 片方だけ打ち切っても長さの上限は満たしてしまうため。
                assert_eq!(
                    message.matches('…').count(),
                    2,
                    "理由文と引用の両方が打ち切られていない: {message}"
                );
            }
        }
    }

    /// 不変条件 1: 合法な局面は必ず通る。
    ///
    /// 成駒を `+X` で書き、空きマスを畳まずに `1` の並びで書いた盤面が、
    /// 正当な入力の最長。`MAX_INPUT_CHARS` を詰めるとここが落ちる。
    /// 正当な入力の最長。盤面と持駒の合計は駒の置き方によらず 127 字で、
    /// 前置き・手番・10桁の手数を足して 155 字。
    const LONGEST_VALID_INPUT_CHARS: usize = 155;

    /// 上限がこれを下回ると、正当な局面が入口の検査で落ちる。
    /// コンパイル時に見るので、定数を詰めた時点で気づける。
    const _: () = assert!(MAX_INPUT_CHARS >= LONGEST_VALID_INPUT_CHARS);

    #[test]
    fn a_maximally_spelled_board_is_accepted() {
        // 成れる34枚を `+X`、玉2枚と空きマス45を `1` で書いた盤面（123字）。
        // 金4枚は成れないので持駒に置く（盤へ戻しても合計の字数は変わらない）。
        let board = concat!(
            "+P1+P1+P1+P1+P/",
            "+P1+P1+P1+P1+P/",
            "+P1+P1+P1+P1+P/",
            "+P1+P1+P1+L1+L/",
            "+L1+L1+N1+N1+N/",
            "+N1+S1+S1+S1+S/",
            "+B1+B1+R1+R11/",
            "1K1k11111/",
            "111111111",
        );
        // 金は成れないので、持駒へ移しても盤面の字数は縮まない（空きマスの `1` が
        // 増えるだけ）。持駒と最大桁の手数を載せた形が、正当な入力の最長。
        let input = format!("position sfen {board} b GGGG 4294967295");

        // 境界を等式で固定する。`<=` だけだと、上限を 155 まで詰めても落ちない。
        assert_eq!(input.chars().count(), LONGEST_VALID_INPUT_CHARS);
        assert!(to_book_key(&input).is_ok(), "{:?}", to_book_key(&input));
    }

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
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "input={input:?}");
            assert!(
                err.message().contains("指し手列"),
                "message={:?} input={input:?}",
                err.message()
            );
        }
    }

    #[test]
    fn rejects_trailing_tokens_after_the_position() {
        for input in ["startpos extra", &format!("{HIRATE_SFEN} extra")] {
            let err = to_book_key(input).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "input={input:?}");
        }
    }

    #[test]
    fn rejects_a_non_numeric_move_number() {
        let err = to_book_key("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - x")
            .unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidSfen);
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
        for spelling in ["2p2P", "PP2p", "2Ppp", "pp2P"] {
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

    /// 冗長な綴りを受け付けると、同じ局面を好きなだけ長く書けてしまい、
    /// 正当な入力の最長という概念が消える（`MAX_INPUT_CHARS` の根拠が崩れる）。
    #[test]
    fn rejects_redundant_spellings_that_would_unbound_the_length() {
        // 持駒の枚数 1 の明示、先頭ゼロ
        for hands in ["1P", "01P", "018P", "0P"] {
            let err = to_book_key(&bare_with_hands(hands)).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "hands={hands}");
        }

        // 手数の先頭ゼロ
        for ply in ["01", "0001"] {
            let err = to_book_key(&format!("{BARE_BOARD} b - {ply}")).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "ply={ply}");
            assert!(
                err.message().contains("先頭ゼロ"),
                "message={}",
                err.message()
            );
        }
    }

    #[test]
    fn rejects_a_broken_hand_field() {
        for hands in ["K", "k", "0P", "19P", "2", "-P", "P-", "+P", "x"] {
            let err = to_book_key(&bare_with_hands(hands)).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "hands={hands}");
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
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "board={board}");
        }
    }

    /// 駒箱に入っていない枚数の局面は将棋に存在しないので、どの定跡にも載っていない。
    /// 素通しすると「定跡に載っていない」と見分けが付かなくなる。
    #[test]
    fn rejects_more_pieces_than_the_set_holds() {
        // 1トークンでは上限内でも、合算すると超える
        for hands in ["18P1P", "9P9P1P", "3R", "3r", "2R1r", "5G"] {
            let err = to_book_key(&bare_with_hands(hands)).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "hands={hands}");
        }

        // 盤上と持駒の通し。平手には既に歩が18枚ある
        let err = to_book_key("lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b P 1")
            .unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidSfen);

        for board in [
            // 玉が9枚
            "KKKKKKKKK/9/9/9/9/9/9/9/9",
            // 同じ側に玉が2枚。合計は2枚なので、片側だけを見る検査でしか落ちない
            "3kk4/9/9/9/9/9/9/9/9",
            // 歩が81枚
            "PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP/PPPPPPPPP",
        ] {
            let err = to_book_key(&format!("{board} b - 1")).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "board={board}");
        }
    }

    /// 1トークンの枚数の境界。`HandCount(1)` と書けないこと自体が、
    /// 検査を通さずに数え上げへ渡せないことの証拠になっている。
    #[test]
    fn hand_count_parse_rejects_values_outside_one_token() {
        assert_eq!(HandCount::parse("").unwrap().get(), 1);
        assert_eq!(HandCount::parse("18").unwrap().get(), 18);

        for digits in ["0", "19", "4294967295", "99999999999"] {
            let err = HandCount::parse(digits).unwrap_err();
            assert!(err.contains("範囲外"), "digits={digits} err={err}");
        }
    }

    #[test]
    fn a_huge_hand_count_is_rejected() {
        for hands in ["19P", "4294967295P", "99999999999P"] {
            let err = to_book_key(&bare_with_hands(hands)).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "hands={hands}");
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

    /// トークンが欠ける3枝（局面 / 手番 / 持駒）と、手番の値が不正な枝を、
    /// 理由文まで見て別々に固定する。
    /// 種別だけを見ると、どれも同じ InvalidSfen なので区別が付かない。
    #[test]
    fn rejects_input_that_is_not_a_position() {
        let cases = [
            ("", "局面が空"),
            ("   ", "局面が空"),
            ("sfen", "局面が空"),
            ("lnsgkgsnl", "手番が無い"),
            ("sfen lnsgkgsnl", "手番が無い"),
            ("lnsgkgsnl b", "持駒が無い"),
            ("lnsgkgsnl x - 1", "手番が b でも w でもない"),
        ];

        for (input, reason) in cases {
            let err = to_book_key(input).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidSfen, "input={input:?}");
            assert!(
                err.message().contains(reason),
                "input={input:?} message={}",
                err.message()
            );
        }
    }
}
