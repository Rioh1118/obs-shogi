//! 索引を組んだ結果を、利用者の言葉で伝える。
//!
//! **どちらも `Display` が画面に出る文言。** 打ち切った線1本ぶんが
//! [`BuildWarn`]、ファイルごと諦めたのが [`BuildError`]。
//! 経路は違うが、どちらも最後は同じ `EVT_INDEX_WARN` に載る。
//!
//! 歩き方そのものは [`super::index_builder`]。**言葉を直すのにあちらを
//! 読む必要は無いし、歩き方を直すのにこちらを読む必要も無い。**

use thiserror::Error;

use crate::search::position::position_apply::ApplyError;
use crate::search::types::CursorLite;

/// 索引を組む途中で打ち切った手順。
///
/// **これを画面に出す口は `BuildWarn` の `Display` だけ。**
/// ただし警告の口そのものは1つではない — [`BuildError`] が返ったときは
/// その `Display` が呼び手の `map_err` を通って同じ `EVT_INDEX_WARN` に出る。
#[derive(Debug, Clone)]
pub struct BuildWarn {
    /// 打ち切った場所。**`tesuu` は指せなかった手そのものの番号。**
    /// `tesuu = N` なら N 手目が指せず、**その手は指されていない**ので
    /// N 手目以降の局面は索引に無い（N-1 手目までは入っている）。
    ///
    /// 番号が合う根拠は、どちらも `walk_sequence` の `start_tesuu`。
    /// 本譜は `build_index_for_jkf` が `moves[1..]` を `1` で渡し、
    /// 変化は `walk_sequence` が `fork_line` を**分岐点と同じ `tesuu`** で
    /// 再帰する（変化の1手目は元の N 手目の代わり）。
    ///
    /// `push_or_replace_fork` が決めるのは `fork_pointers[].te`（どこで分かれたか）
    /// であって、変化の中の `tesuu` ではない。
    pub cursor: CursorLite,
    /// `ApplyError` の英語。**画面には出さない**（内部の理由）
    pub message: String,
}

/// 利用者に出す文言。**`EVT_INDEX_WARN` に載るのはこれ。**
///
/// [`BuildError`] も `Display` が画面の文言なので、警告の口に載る2つが
/// 同じ描き方で揃う。**`message`（英語の内部の理由）はここに出ない。**
///
/// `cursor` の `Debug` と `message`（`ApplyError` の英語）をそのまま並べると、
/// 画面に `CursorLite { tesuu: 30, fork_pointers: [] }: side-to-move mismatch: …`
/// が素のテキストで出る（`WorkspaceTab` は Markdown を解釈しない）。
/// 何が起きたかが利用者の言葉になっておらず、次に何をすればよいかも無い。
///
/// **内部の理由（`message`）はここで捨てる。** 呼び手がログへ回す。
///
/// **次に何をすればよいかまで書く。** 場所だけ言われても、直せば索引に
/// 入り直すのか放っておいてよいのかが分からない。画面（`WorkspaceTab`）に
/// あるのは「警告をクリア」だけで、開く導線も再構築のボタンも無い。
/// 「直して保存すれば入り直す」が成り立つのは、読み直しを決めるのが
/// `fs_scan` の `(size, mtime_ms)` 比較だから。
///
/// **変化の中なら、そう言う。** 本譜が最後まで正しく変化にだけ反則手がある棋譜で
/// 「30手目」とだけ言うと、利用者は本譜の30手目を見に行って何も見つけられない。
/// 同じ手数で本譜と変化の両方が打ち切られたときに、文言が同じにならない意味もある。
///
/// **言葉は画面に合わせる。** `branchLabel`（`entities/kifu/model/branch.ts`）が
/// 「本譜」「変化N」で、N は `forkIndex + 1`。ここだけ「本線」「変化」と呼ぶと、
/// 警告に出た変化を棋譜欄で探すときに名前で突き合わせられない。
///
/// **見るのは `fork_pointers` の末尾。** 変化の中の変化では先頭が一番外側で、
/// 打ち切られた手が乗っている線を決めるのは**一番内側の選択**。
/// 先頭を見ると、外側の分岐点を名指して利用者を別の場所へ送る。
///
/// **`tesuu` に足さない。** `walk_sequence` は `moves[1..]` を `start_tesuu = 1` で
/// 歩くので、`tesuu` はそのまま「何手目が指せなかったか」。足すと、
/// 索引に入っていない1つ先の手を名指しすることになる。
/// 検索結果の `手数` 表示（`PositionHitItem`）も `tesuu` を素で描くので、
/// ずらすとアプリの中で数え方が2つになる。
impl std::fmt::Display for BuildWarn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let where_ = match self.cursor.fork_pointers.last() {
            None => "本譜の".to_owned(),
            Some(fork) => format!("{}手目から分かれた変化{}の", fork.te, fork.fork_index + 1),
        };
        write!(
            f,
            "{where_}{}手目に、その局面では指せない手があります。\
             この手順はそこで打ち切られるので、より先の局面は検索に出ません。\
             棋譜を開いてその手を確かめてください。直して保存すれば索引に入り直します",
            self.cursor.tesuu
        )
    }
}
/// 索引を組めなかった理由。
///
/// **`Display` がそのまま利用者の画面に出る**（呼び手が `map_err(|e| e.to_string())`
/// で `EVT_INDEX_WARN` に流す）。`ParseFailed` のような文字数の刈り込みも通らない。
///
/// **[`BuildPolicy::Loose`] でも `Initial` は返る。** `build_index_for_jkf` が
/// 開始局面を組むのは `policy` を見るより前なので、`Loose` が受け止めるのは
/// `Apply` だけ。`.jkf` は外部の JSON をそのまま信じるうえ、
/// `kifu_reader.rs` の `says_nothing` は `preset != PresetHirate` を
/// 「中身がある」と見るので、`{"initial":{"preset":"OTHER"}}` はここまで届く。
///
/// 内部の理由を括弧に残すのは、利用者の言葉だけにすると報告を受けた側が
/// 原因を絞れないから（`ParseFailed` と同じ形）。
#[derive(Debug, Error)]
pub enum BuildError {
    #[error(
        "開始局面を組み立てられませんでした。このファイルの局面は検索に出ません。\
         書き出し元のアプリで保存し直してください（内部の理由: {0}）"
    )]
    Initial(#[from] shogi_kifu_converter_obsshogi::error::ConvertError),

    #[error(
        "{}手目に、その局面では指せない手があります。\
         このファイルの局面は検索に出ません。\
         棋譜を開いてその手を確かめてください（内部の理由: {source}）",
        cursor.tesuu
    )]
    Apply {
        cursor: CursorLite,
        #[source]
        source: ApplyError,
    },
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::types::ForkPointer;

    /// 警告の手数が、指せなかった手そのものを指す。
    ///
    /// `tesuu` の起点は `walk_sequence(&moves[1..], 1, ..)` で決まっていて、
    /// 1手目が `tesuu = 1`。**足すと索引に入っていない1つ先を名指しする**
    /// （打ち切るので、その手より先は入らない）。
    /// 検索結果の `手数` 表示も `tesuu` を素で描くので、ずらすと数え方が2つになる。
    #[test]
    fn the_warning_names_the_move_that_could_not_be_played() {
        let warn = BuildWarn {
            cursor: CursorLite {
                tesuu: 30,
                fork_pointers: vec![],
            },
            message: "side-to-move mismatch".to_owned(),
        };
        let message = warn.to_string();

        assert!(
            message.contains("30手目"),
            "指せなかった手そのものを言っていない: {message}"
        );
        // 変化でないなら本譜と言う。同じ手数で2件出たときに区別が付く
        assert!(
            message.contains("本譜"),
            "どの手順かを言っていない: {message}"
        );
        // 内部の理由は出さない。`WorkspaceTab` は素のテキストで描く
        assert!(
            !message.contains("side-to-move"),
            "内部の理由が画面に出る: {message}"
        );
        // 場所だけ言って終わらない。`EVT_INDEX_WARN` に載る他の文言と揃える
        assert!(
            message.contains("ください"),
            "次に何をすればよいかが無い: {message}"
        );
    }

    /// 変化の中の変化では、**一番内側の分岐点**を名指す。
    ///
    /// `fork_pointers` は外側から並ぶので、先頭を見ると
    /// 「10手目から分かれた変化」と言ってしまう。打ち切られた手が乗っているのは
    /// **20手目から分かれた線**で、利用者が開くべきはそちら。
    ///
    /// 番号は `branchLabel`（`entities/kifu/model/branch.ts`）に合わせて
    /// `fork_index + 1`。画面が「変化2」と描いているものを
    /// ここが「変化1」と呼ぶと、名前で突き合わせられない。
    #[test]
    fn the_warning_names_the_innermost_variation() {
        let warn = BuildWarn {
            cursor: CursorLite {
                tesuu: 25,
                fork_pointers: vec![
                    ForkPointer {
                        te: 10,
                        fork_index: 0,
                    },
                    ForkPointer {
                        te: 20,
                        fork_index: 1,
                    },
                ],
            },
            message: "side-to-move mismatch".to_owned(),
        };
        let message = warn.to_string();

        assert!(
            message.contains("20手目から分かれた変化2"),
            "一番内側の分岐点を言っていない: {message}"
        );
        assert!(
            !message.contains("10手目"),
            "外側の分岐点で利用者を別の場所へ送っている: {message}"
        );
        assert!(
            message.contains("25手目"),
            "指せなかった手を言っていない: {message}"
        );
    }
}
