//! 1行を1つの候補手に読む。
//!
//! やねうら王テキスト定跡の指し手の行は空白区切りの5欄で、後ろの欄ほど
//! 欠けやすい（配布元によって深さや局面数を書かない）。**欠けは失敗にしない** ——
//! 定跡としては指し手さえ読めれば使えるので、読めなかった欄は数えて捨て、
//! [`DroppedFields`] が最後に1回だけ報告する。
//!
//! **形の検査は USI の文法ではない。** ここで弾きたいのは「そもそも指し手の
//! 行でないもの」だけで、指し手として正しいかは引く側が決める。

use crate::book::types::BookMove;

/// 読めずに捨てた欄の数。
///
/// 落とした事実がどこにも出ないと、誤読みだと分かる手がかりが利用者にも
/// 報告を受けた側にも無い。行ごとに `log` を出すと 100 万行でログが溢れるので、
/// 数えて最後に1回だけ出す。
#[derive(Default)]
pub(super) struct DroppedFields {
    pub(super) ponder: usize,
    pub(super) numbers: usize,
}

/// 指し手の行を1つ読む。
///
/// 並びは `指し手 応手 評価値 深さ 選択回数`。**先頭以外は行によって欠ける**
/// （欠かし方は [`ABSENT_MOVE`] と空欄の2通りで、同じファイルの中で混ざる）。
///
/// **区切りは1つの空白で数える**（`split_whitespace` ではない）。空欄で省いた
/// 定跡で連続した空白を畳むと欄が1つずつずれ、`深さ 32` が `評価値 +32` として
/// 画面に出る。エラーにならないので誰も気づけない。
///
/// 本家は畳む側（一次資料の表の `LineScanner::peek_text` の行）なので、
/// **ここは本家と一致しない。** 差が出るのは空欄で省いた定跡だけで、
/// そこでは書いた側の意図が「欄を空けた」なので畳まない方が合う。
///
/// 呼び出し側が空行と注記を除いてから渡すので、先頭のトークンは必ず存在する。
/// 指し手として成立しているかは呼び出し側が [`looks_like_a_move`] で見る。
pub(super) fn parse_move(line: &str, dropped: &mut DroppedFields) -> BookMove {
    // 6つ目以降は形式に無い。畳んでおけば、末尾に何か付いていても欄がずれない。
    let mut tokens = line.splitn(6, ' ');

    let usi_move = tokens
        .next()
        .expect("splitn は必ず1つ返す。呼び出し側が空行を除いている")
        .to_string();

    BookMove {
        usi_move,
        ponder: optional_move(tokens.next(), dropped),
        value: optional_number(tokens.next(), dropped),
        depth: optional_number(tokens.next(), dropped),
        count: optional_number(tokens.next(), dropped),
    }
}

/// 指し手の綴りとして成立しうる最長。
///
/// USI の指し手は `7g7f` / `7g7f+`（成り）/ `P*5e`（打つ手）で最長5字。
/// 「指し手が無い」の綴りは `resign` の6字。余裕を1字持たせる。
const MAX_MOVE_CHARS: usize = 7;

/// 指し手の綴りとして成立しうる形か。
///
/// **綴りの一覧は持たない。** 定跡側が使う綴りを網羅できないので、一覧で
/// 弾くと読めるはずの定跡が開けなくなる。見るのは「短い ASCII の英数字と記号」
/// という形だけで、これは実在する綴り（`7g7f` / `7g7f+` / `P*5e`）をすべて通し、
/// 紛れ込んだ日本語・HTML・長いテキストを落とす。
///
/// 「指し手が無い」の綴り（[`ABSENT_MOVE`]）もこの形は満たす。**それらを
/// 落とすのは呼び出し側の役目**で、形の検査には入れない（形と意味は別の層）。
pub(super) fn looks_like_a_move(token: &str) -> bool {
    // 形式のキーワード。`sfen` 行の途中で切れたファイルでは、これが指し手の
    // 位置に来る（実測で `usi_move: "sfen"` が候補手に入った）。形は満たすので、
    // 綴りで外す。
    if token == "sfen" {
        return false;
    }

    !token.is_empty()
        && token.chars().count() <= MAX_MOVE_CHARS
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '*' || c == '+')
}

/// 欄が省略されていることを表す綴り。
///
/// 出典: 本家 `source/book/book.cpp:114-115`。**指し手の欄と応手の欄の両方**で
/// 同じ3綴りを見る。片方だけに当てると、盤に適用できない綴りが
/// 候補手の先頭＝best move の位置に座る。
///
/// **評価値と深さの欄にも当てる。** ShogiHome はこの2つを省くとき `none` を
/// 書き出す（`src/background/book/yaneuraou.ts` の `SCORE_NONE` / `DEPTH_NONE`。
/// 空文字は v1.20.0 までの書き方で、「やねうら王や BookConv は連続するスペースを
/// まとめて読み込む」ため非推奨になった）。当てないと `7g7f none none none 103`
/// という**現行の標準的な行**が数値欄2つぶんの欠損として数えられ、正常な定跡が
/// 指し手の数より多い欠損を報告する。
pub(super) const ABSENT_MOVE: [&str; 3] = ["none", "None", "resign"];

/// 応手の欄を読む。省略・空欄・「指し手が無い」の綴りはすべて欠損。
fn optional_move(token: Option<&str>, dropped: &mut DroppedFields) -> Option<String> {
    let token = token?.trim();
    if token.is_empty() || ABSENT_MOVE.contains(&token) {
        return None;
    }
    // 形を満たさない応手は、指し手として渡せないので落とす。ここで落としても
    // 候補手そのものは残るので、定跡が引けなくなることはない。
    if !looks_like_a_move(token) {
        dropped.ponder += 1;
        return None;
    }
    Some(token.to_string())
}

/// 数値として読めない綴りは、行ごと落とさずに欠損として扱う。
///
/// 評価値や深さは付加情報で、無くても候補手としては使える。
///
/// **ここを `Result` にすると、失うのはその局面ではなく定跡ファイル全体。**
/// `Err` は `parse` → `load` → `open_reader` を素通しして `open_book` ごと
/// 失敗させるので、評価値の綴りが1つ壊れているだけの数百 MB の定跡が
/// まったく開けなくなる。
fn optional_number<T: std::str::FromStr>(
    token: Option<&str>,
    dropped: &mut DroppedFields,
) -> Option<T> {
    let token = token?.trim();
    // 省略の綴りは「読めなかった」ではないので数えない。数えると、正常な定跡が
    // 毎回ログを出し、本当に読めなかった場合と区別が付かなくなる。
    if token.is_empty() || ABSENT_MOVE.contains(&token) {
        return None;
    }
    match token.parse() {
        Ok(value) => Some(value),
        Err(_) => {
            dropped.numbers += 1;
            None
        }
    }
}
