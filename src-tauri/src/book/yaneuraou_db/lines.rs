//! 1行を読み、それが**何の行か**だけを決める。
//!
//! この形式の1行は、見出し・局面・候補手・注記・空行のどれか。
//! どれであるかは先頭の綴りだけで決まり、走査がどこまで進んだかに依らない ——
//! だから状態を持たずに切り出せる。
//!
//! **注記は中身を読まない。** 配布元の注記は Shift_JIS のことがあり、
//! UTF-8 として読めないバイト列が混ざる。読もうとすると、定跡そのものは
//! 無傷なのに開けなくなる。

use super::diagnose::invalid_content;
use super::limits::MAX_LINE_BYTES;
use crate::book::error::{format_size, BookError};
use std::io::BufRead;

/// 行の残りを読み捨てる。確保は [`MAX_LINE_BYTES`] ずつで頭打ち。
fn discard_rest_of_line<R: BufRead>(reader: &mut R, path: &str) -> Result<(), BookError> {
    let mut sink = Vec::new();
    loop {
        sink.clear();
        let read = std::io::Read::take(reader.by_ref(), MAX_LINE_BYTES as u64)
            .read_until(b'\n', &mut sink)
            .map_err(|e| BookError::from_io(e, path))?;
        if read == 0 || sink.ends_with(b"\n") {
            return Ok(());
        }
    }
}

/// 1行読む。行末の改行と、最初の行だけ BOM を落とす。
///
/// 壊れたバイト列を lossy で読むと、置換文字を含むキーが黙って登録される。
/// そのキーは引かれることが無いので、「定跡に載っていない」と区別が付かない。
/// `read_line` は不正な UTF-8 に `InvalidData` を返すので、それを利用者向けの
/// 文面へ言い直す。
/// 返り値は「読めたか」と「その行が改行で終わっていたか」。
///
/// 1行が [`MAX_LINE_BYTES`] を超えて改行が来ないときは `InvalidContent` で落とす
/// （理由は定数の doc）。不正な UTF-8 も落とす。**どちらも注記なら落とさず、
/// 残りを読み捨てて読み進む**（本家は注記の中身を見ないので、長い注記を1行
/// 持つだけの正しい定跡がある）。読み捨てた行では、改行の有無にかかわらず
/// 2つ目に `true` を返す。
///
/// **2つ目は切れの判定には使わない。** 行境界で切れたファイルは素通りするので
/// 根拠にならない（理由は `parse_limited` の末尾）。事実として `log::warn!` に
/// 出すためだけに返す。
///
/// **バイト列で読んで、行ごとに UTF-8 を試す。** ファイル全体を UTF-8 として
/// 読むと、Shift_JIS の注記が1行あるだけで定跡全体が拒否される。本家は行を
/// 生のバイト列として読み、注記は中身を見ずに捨てるので、そういう定跡を普通に
/// 読む。注記でない行が読めないときだけ落とす（キーが置換文字で汚れる懸念は、
/// `sfen` 行と指し手行に厳格な UTF-8 を課したままなので保たれる）。
pub(super) fn read_line<R: BufRead>(
    reader: &mut R,
    raw: &mut Vec<u8>,
    buffer: &mut String,
    first: bool,
    line_number: usize,
    path: &str,
) -> Result<Option<bool>, BookError> {
    raw.clear();
    // 上限の根拠は `MAX_LINE_BYTES` の doc。
    let read = std::io::Read::take(reader.by_ref(), MAX_LINE_BYTES as u64 + 1)
        .read_until(b'\n', raw)
        .map_err(|e| BookError::from_io(e, path))?;

    if read == 0 {
        return Ok(None);
    }

    // **長さの検査より前に落とす。** BOM を残したまま `is_note` に渡すと、
    // `0xEF` は ASCII 空白ではないので1行目の注記が注記と判定されない。
    // BOM 付きの `.db` は実在する（ShogiHome が開ける側の fixture に持っている）
    // ので、1行目に長い生成情報コメントを置いた定跡が BOM の有無だけで拒否される。
    if first && raw.starts_with(&BOM) {
        raw.drain(..BOM.len());
    }

    // 見るのは**読んだバイト数**。`raw.len()` だと BOM を落とした3バイトぶん
    // 短くなって上限をすり抜け、行の残りが次の行として読まれる。
    if read > MAX_LINE_BYTES && !raw.ends_with(b"\n") {
        // **注記だけは捨てて読み進む。** 本家は注記の中身を見ないので、長い注記を
        // 1行持つだけの定跡を普通に読む。拒否すると、正しい定跡に対して
        // 「別のファイルを選び直すこと」という効かない復帰操作を出すことになる。
        // 自由に伸びうるのは注記だけなので、ここを通せば残りは短い。
        if is_note(raw) {
            discard_rest_of_line(reader, path)?;
            raw.clear();
            buffer.clear();
            buffer.push('#');
            return Ok(Some(true));
        }

        return Err(invalid_content(
            &format!(
                "{line_number}行目が長すぎる（{} を超えている）。定跡ファイルでは\
                 ないかもしれない。別のファイルを選び直すこと",
                format_size(MAX_LINE_BYTES as u64)
            ),
            path,
        ));
    }

    let terminated = raw.ends_with(b"\n");
    while raw.ends_with(b"\n") || raw.ends_with(b"\r") {
        raw.pop();
    }

    buffer.clear();
    match std::str::from_utf8(raw) {
        Ok(line) => buffer.push_str(line),
        Err(_) => {
            // 注記なら中身を見ない。本家と同じ扱い。
            if is_note(raw) {
                return Ok(Some(terminated));
            }
            // **形式違いの可能性を先に言う。** 「文字として読めないバイト」は
            // 利用者の言葉ではないし、最初に提示する復帰操作が「取得し直す」だと、
            // `.bin` を `.db` に付け替えただけのファイルでは何度やっても直らない。
            return Err(invalid_content(
                &format!(
                    "やねうら王テキスト定跡 (.db) として読めない\
                     （{line_number}行目に文字として読めないバイトがある）。\
                     別の形式のファイルかもしれない。取得し直すか、別の定跡を開くこと"
                ),
                path,
            ));
        }
    }

    Ok(Some(terminated))
}

/// ヘッダの綴り。バージョンは見ない（`1.00` 以外が配られても中身の書式は同じ）。
pub(super) const HEADER_PREFIX: &str = "#YANEURAOU-DB";

/// UTF-8 の BOM。付いたまま配られている定跡がある。
const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

/// 局面行の頭。
pub(super) const POSITION_PREFIX: &str = "sfen ";

/// 読み飛ばす行。
///
/// **`//` を落とすのは形式の一部**（本家 `source/book/book.cpp:314-320` が
/// `#` と `//` の両方を読み飛ばす）。落とさないと2通りに壊れる。
///
/// - `sfen` 行の後ろにあると候補手として登録され、しかも先頭に来る。
///   形式は「先頭がその局面の best move」と約束しているので、`//` が推奨手になる
/// - 最初の `sfen` 行より前にあると「局面より先に指し手」の枝に落ち、
///   本家が普通に読める定跡が丸ごと開けなくなる
pub(super) fn is_skippable(line: &str) -> bool {
    line.is_empty() || is_note(line.as_bytes())
}

/// 注記の行か。**バイト列で見る。** 文字コードの分からない注記を落とす判定に
/// 使うので、`str` に直す前に呼べる必要がある。
///
/// 字下げを許すのは、パーサの他の判定が全て `trim` 済みの行を見ているため。
/// ここだけ生の先頭で見ると、**字下げした注記だけが別の文字コードで拒否される**
/// という説明できない挙動になる。
pub(super) fn is_note(raw: &[u8]) -> bool {
    let body = raw
        .iter()
        .position(|b| !b.is_ascii_whitespace())
        .map_or(&raw[..0], |at| &raw[at..]);
    body.starts_with(b"#") || body.starts_with(b"//")
}

/// ファイル自身が申告する収録局面数の綴り。
const DECLARED_COUNT_PREFIX: &str = "# NOE:";

/// 申告された局面数を読む。
///
/// **この値を確保に使ってはいけない。** `# NOE:99999999999` と書かれた 40 バイトの
/// ファイルで `with_capacity` を呼ぶと確保が失敗し、`handle_alloc_error` で
/// abort する（`BookReader` の「壊れた内容で panic しない」に正面から反する）。
/// 使い道は展開後の実数との突き合わせだけ。
pub(super) fn declared_count(line: &str) -> Option<u64> {
    line.strip_prefix(DECLARED_COUNT_PREFIX)?
        .trim()
        .parse()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **上限ちょうどの行に改行が付いているだけの定跡を拒否しない。**
    ///
    /// `take(MAX_LINE_BYTES + 1)` で読むので `read` が上限を1つ超えるのは
    /// 「内容ちょうど上限 + 改行」のときだけ。`!raw.ends_with(b"\n")` を落とすと、
    /// 正しい定跡に「4.1KB を超えている。別のファイルを選び直すこと」を返す
    /// （利用者に実行できる操作が対応しない）。
    #[test]
    fn a_line_of_exactly_the_limit_with_a_newline_is_accepted() {
        let mut line = "7g7f none 0 0 1".to_string();
        while line.len() < MAX_LINE_BYTES {
            line.push(' ');
        }
        assert_eq!(line.len(), MAX_LINE_BYTES);
        line.push('\n');

        let mut reader = std::io::Cursor::new(line.clone().into_bytes());
        let mut buffer = String::new();
        let mut raw = Vec::new();
        let read = read_line(&mut reader, &mut raw, &mut buffer, true, 1, "a.db")
            .expect("上限ちょうど＋改行は読めるはず");

        assert_eq!(read, Some(true));
        assert_eq!(buffer.trim_end(), line.trim_end());
    }

    /// 注記の判定は字下げを許す。パーサの他の判定は全て `trim` 済みの行を見るので、
    /// ここだけ生の先頭で見ると、字下げした注記だけが別の文字コードで拒否される。
    #[test]
    fn an_indented_note_is_still_a_note() {
        assert!(is_note(b"# a"));
        assert!(is_note(b"  # a"));
        assert!(is_note(b"\t// a"));
        assert!(!is_note(b"7g7f none 0 0 1"));
        assert!(!is_note(b""));
    }
}
