//! やねうら王テキスト定跡 (`.db`) の読み手。
//!
//! 出典: やねうら王 Wiki「定跡の作成」、`source/book/book.h`。
//!
//! ```text
//! #YANEURAOU-DB2016 1.00
//! sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1
//! 7g7f 3c3d 50 32 1234
//! 2g2f 8c8d -10 32 567
//! ```
//!
//! **ファイルは丸ごとメモリへ展開する。** ファイル上を二分探索する形にしないのは、
//! それが「キーがバイト単位で一致していること」と「整列済みであること」に依存する
//! ため。実物の定跡がその前提を外すと、エラーにならずに**全ての lookup が空を返す**。
//! 展開してしまえばファイル側のキーも [`to_book_key_in_file`] を通せるので、
//! 綴りの揺れを吸収でき、持駒の並びの取り決めが lookup の正しさに影響しなくなる。
//!
//! 大きさの上限はここで持つ（値の根拠は [`MAX_FILE_BYTES`]）。
//! 進捗と中断は #197。

use crate::book::error::{BookError, BookErrorCode};
use crate::book::sfen::{excerpt, to_book_key_in_file, BookKey};
use crate::book::types::BookMove;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::io::BufRead;
use std::path::Path;

/// 展開済みの定跡。
pub(crate) struct YaneuraouDbReader {
    positions: HashMap<BookKey, Vec<BookMove>>,
}

impl YaneuraouDbReader {
    pub(crate) fn position_count(&self) -> u64 {
        self.positions.len() as u64
    }
}

impl super::reader::BookReader for YaneuraouDbReader {
    fn lookup(&self, key: &BookKey) -> Result<Vec<BookMove>, BookError> {
        Ok(self.positions.get(key).cloned().unwrap_or_default())
    }
}

/// ファイルを読んで展開する。
///
/// **1行ずつ読む。** ファイル全体を先に確保すると、そのバッファが展開の間ずっと
/// 生きるので、ピークに入力サイズがそのまま乗る（実測でピークの 18.6%）。
/// 展開後の map しか残らない形にすると、100MB の定跡でピークが 541MB → 316MB。
pub(crate) fn load(path: &Path, size: u64) -> Result<YaneuraouDbReader, BookError> {
    let shown = path.to_string_lossy();

    if size > MAX_FILE_BYTES {
        return Err(BookError::new(
            BookErrorCode::TooLarge,
            format!(
                "この定跡は大きすぎて開けない（{} / 上限 {}）。\
                 分割された定跡を使うか、別の定跡を開くこと",
                mebibytes(size),
                mebibytes(MAX_FILE_BYTES)
            ),
        )
        .with_path(shown.clone()));
    }

    let file = std::fs::File::open(path).map_err(|e| BookError::from_io(e, shown.clone()))?;
    let positions = parse(std::io::BufReader::new(file), &shown)?;
    Ok(YaneuraouDbReader { positions })
}

/// 1行読む。行末の改行と、最初の行だけ BOM を落とす。
///
/// 壊れたバイト列を lossy で読むと、置換文字を含むキーが黙って登録される。
/// そのキーは引かれることが無いので、「定跡に載っていない」と区別が付かない。
/// `read_line` は不正な UTF-8 に `InvalidData` を返すので、それを利用者向けの
/// 文面へ言い直す。
fn read_line<R: BufRead>(
    reader: &mut R,
    buffer: &mut String,
    first: bool,
    path: &str,
) -> Result<bool, BookError> {
    buffer.clear();
    let read = reader.read_line(buffer).map_err(|e| {
        if e.kind() == std::io::ErrorKind::InvalidData {
            invalid_content(
                "定跡ファイルがテキストとして読めない。やねうら王テキスト定跡 (.db) 以外の\
                 ファイルを選んでいないか確かめ、選び直すこと",
                path,
            )
        } else {
            BookError::from_io(e, path)
        }
    })?;

    if read == 0 {
        return Ok(false);
    }

    // BOM 付きで配られている定跡がある。落とさないとヘッダの検査が必ず外れる。
    if first {
        if let Some(rest) = buffer.strip_prefix('\u{feff}') {
            *buffer = rest.to_string();
        }
    }

    while buffer.ends_with('\n') || buffer.ends_with('\r') {
        buffer.pop();
    }
    Ok(true)
}

/// 失敗に行番号を前置する。
///
/// `to_book_key_in_file` は行の中身しか知らないので、位置はここで足す。
fn annotate_line(err: BookError, line_number: usize) -> BookError {
    let annotated = BookError::new(err.code(), format!("{line_number}行目: {}", err.message()));
    match err.path() {
        Some(path) => annotated.with_path(path),
        None => annotated,
    }
}

fn invalid_content(message: &str, path: &str) -> BookError {
    BookError::new(BookErrorCode::InvalidContent, message).with_path(path)
}

/// 開けるファイルの上限。
///
/// **根拠は実測。** `#[global_allocator]` で確保バイトを数えた（合成定跡、
/// 1局面 193 バイト・5手/局面。実物の行長に寄せてある）。
///
/// | ファイル | 展開後 | ピーク |
/// | --- | --- | --- |
/// | 100.4 MB | 316 MB | 316 MB（1行ずつ読むのでファイル側は乗らない） |
///
/// 展開後はファイルの **約 3.15 倍**。倍率は手数/局面に効き、3手で 3.2 倍、
/// 10手で 3.9 倍。上限を 512 MiB に置くと、最悪でも展開後 2 GB 前後で収まる。
///
/// 公開の無償定跡は圧縮後 0.78〜72.6MB（`research/findings/L3-book-solved.md`）で、
/// 展開してもこの上限には遠い。**弾くのは定跡でないファイルを選んだ場合が主。**
///
/// #96 で複数の定跡を同時に開けるようになると、この上限は1本ぶんの意味になる。
const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;

/// 利用者に見せる大きさ。バイト数のままでは大小を掴めない。
fn mebibytes(bytes: u64) -> String {
    format!("{:.1}MB", bytes as f64 / (1024.0 * 1024.0))
}

/// ヘッダの綴り。バージョンは見ない（`1.00` 以外が配られても中身の書式は同じ）。
const HEADER_PREFIX: &str = "#YANEURAOU-DB";

/// 読み飛ばす行。
///
/// **`//` を落とすのは形式の一部**（本家 `source/book/book.cpp:710-715` が
/// `#` と `//` の両方を読み飛ばす）。落とさないと2通りに壊れる。
///
/// - `sfen` 行の後ろにあると候補手として登録され、しかも先頭に来る。
///   形式は「先頭がその局面の best move」と約束しているので、`//` が推奨手になる
/// - 最初の `sfen` 行より前にあると「局面より先に指し手」の枝に落ち、
///   本家が普通に読める定跡が丸ごと開けなくなる
fn is_skippable(line: &str) -> bool {
    line.is_empty() || line.starts_with('#') || line.starts_with("//")
}

/// ファイル自身が申告する収録局面数の綴り。
const DECLARED_COUNT_PREFIX: &str = "# NOE:";

/// 申告された局面数を読む。
///
/// **この値を確保に使ってはいけない。** `# NOE:99999999999` と書かれた 40 バイトの
/// ファイルで `with_capacity` を呼ぶと確保が失敗し、`handle_alloc_error` で
/// abort する（`BookReader` の「壊れた内容で panic しない」に正面から反する）。
/// 使い道は展開後の実数との突き合わせだけ。
fn declared_count(line: &str) -> Option<u64> {
    line.strip_prefix(DECLARED_COUNT_PREFIX)?
        .trim()
        .parse()
        .ok()
}

/// 本文を局面ごとに畳む。
///
/// ヘッダを検査するのは、別形式のファイルに `.db` を付けただけのものを
/// 「0局面の定跡」として開かないため。空の定跡と見分けが付かなくなる。
fn parse<R: BufRead>(
    mut reader: R,
    path: &str,
) -> Result<HashMap<BookKey, Vec<BookMove>>, BookError> {
    let mut buffer = String::new();
    let mut index = 0usize;
    let mut header: Option<(usize, String)> = None;

    while read_line(&mut reader, &mut buffer, index == 0, path)? {
        index += 1;
        if !buffer.trim().is_empty() {
            header = Some((index, buffer.trim_end().to_string()));
            break;
        }
    }

    match header.as_ref().map(|(n, line)| (*n, line.as_str())) {
        Some((_, line)) if line.starts_with(HEADER_PREFIX) => {}
        Some((number, line)) => {
            return Err(invalid_content(
                &format!(
                    "やねうら王テキスト定跡の見出しが無い（{number}行目: {}）。\
                     別の形式のファイルかもしれない。取得し直すか、別の定跡を開くこと",
                    excerpt(line)
                ),
                path,
            ))
        }
        None => {
            return Err(invalid_content(
                "定跡ファイルが空。取得し直すか、別の定跡を開くこと",
                path,
            ))
        }
    }

    let mut positions: HashMap<BookKey, Vec<BookMove>> = HashMap::new();
    let mut current: Option<BookKey> = None;
    // 現在の局面ぶんを溜める。行ごとに map を引くと、指し手1行につきキーの確保と
    // ハッシュ計算が1回ずつ走る（100MB の定跡で 312 万回、パース時間の 17%）。
    let mut buffered: Vec<BookMove> = Vec::new();
    let mut declared: Option<u64> = None;
    // 申告と突き合わせるのは `sfen` 行の数。map の要素数ではない（正規化と
    // 重複の畳み込みで減るので、正常な定跡でも一致しない）。
    let mut sfen_lines: u64 = 0;

    while read_line(&mut reader, &mut buffer, false, path)? {
        index += 1;
        let line = buffer.trim();
        if is_skippable(line) {
            if let Some(count) = declared_count(line) {
                declared = Some(count);
            }
            continue;
        }

        if let Some(rest) = line.strip_prefix("sfen ") {
            sfen_lines += 1;
            flush(&mut positions, &mut current, &mut buffered);
            // 行番号を添える。壊れた行だけ位置が分からないと、100万行の定跡で
            // 利用者にも報告を受けた側にも直しようが無い。
            current =
                Some(to_book_key_in_file(rest, path).map_err(|err| annotate_line(err, index))?);
            continue;
        }

        if current.is_none() {
            return Err(invalid_content(
                &format!(
                    "局面より先に指し手が書かれている（{index}行目）。\
                     途中で切れたファイルかもしれない。取得し直すか、別の定跡を開くこと"
                ),
                path,
            ));
        }

        let parsed = parse_move(line);
        if !looks_like_a_move(&parsed.usi_move) {
            return Err(invalid_content(
                &format!(
                    "{index}行目が指し手として読めない（{}）。別のファイルが連結されて\
                     いるかもしれない。取得し直すか、別の定跡を開くこと",
                    excerpt(&parsed.usi_move)
                ),
                path,
            ));
        }
        buffered.push(parsed);
    }

    flush(&mut positions, &mut current, &mut buffered);

    // 途中で切れたファイルは、ヘッダの検査では止まらない。**自分自身が正しい
    // 見出しを持っているから。** 止められるのは中身との突き合わせだけ。
    //
    // ここを素通しすると、先頭数 KB だけ保存されたファイルが `position_count: Some(0)`
    // で成功する。以後どの局面を引いても空が返るので、利用者は「この定跡には
    // 自分の局面が載っていない」と受け取り、取得し直すという唯一の復帰操作に
    // 辿り着けない。
    if let Some(count) = declared {
        // 比べるのは `sfen` 行の数。**`positions.len()` と比べてはいけない。**
        // キーは手数を落とすので、手数違いで2度書かれた局面は1つに畳まれる
        // （`flush` の doc のとおり実在する）。畳んだ後の数と申告を突き合わせると、
        // 正常な定跡が「途中で切れている。取得し直すこと」で拒否され、
        // 何度取得し直しても直らない案内を出すことになる。
        //
        // 読めた行が申告より多いのは、こちらの数え方が壊れている場合なので見ない。
        if sfen_lines < count {
            return Err(invalid_content(
                &format!(
                    "定跡ファイルに {count} 局面と書かれているが {sfen_lines} 局面しか読めない。\
                     途中で切れているかもしれない。取得し直すか、別の定跡を開くこと"
                ),
                path,
            ));
        }
    } else if positions.is_empty() {
        // 申告が無い定跡もあるので、そのときの保険。局面が1つも無い定跡は成立しない。
        return Err(invalid_content(
            "定跡ファイルに局面が1つも書かれていない。途中で切れているかもしれない。\
             取得し直すか、別の定跡を開くこと",
            path,
        ));
    }

    Ok(positions)
}

/// 溜めた指し手を、いまの局面のものとして確定させる。
///
/// **指し手が1つも続かなかった `sfen` 行も、空の `Vec` で登録する。**
/// `lookup` は未収録と同じ空を返すが、`position_count` はこれを数える。
/// 消すと収録局面数だけが黙って減り、テストは全部緑のまま通る。
///
/// `shrink_to_fit` を通すのは、`push` の倍々成長が残す空き容量を捨てるため。
/// 5手の局面は容量8まで伸びるので、1局面あたり 240 バイトが空きになる
/// （実測で展開後の 28%）。
fn flush(
    positions: &mut HashMap<BookKey, Vec<BookMove>>,
    current: &mut Option<BookKey>,
    buffered: &mut Vec<BookMove>,
) {
    let Some(key) = current.take() else {
        return;
    };

    buffered.shrink_to_fit();
    match positions.entry(key) {
        Entry::Vacant(slot) => {
            slot.insert(std::mem::take(buffered));
        }
        // 同じ局面が2度書かれていることがある。キーは手数を落とすので、
        // `... b - 1` と `... b - 31` は同じキーになる（本家 `book.cpp:688-694` が
        // 手数違いの重複が実在したことを認めている）。
        //
        // **同じ指し手は先に読んだ方を残す。** 連ねると同じ指し手が評価値違いで
        // 2度返り、「先頭がその局面の best move」という形式の約束が
        // 2つのエントリの境目で崩れる。ShogiHome も先勝ちを採っている。
        Entry::Occupied(mut slot) => {
            let existing = slot.get_mut();
            for candidate in buffered.drain(..) {
                if !existing.iter().any(|m| m.usi_move == candidate.usi_move) {
                    existing.push(candidate);
                }
            }
        }
    }
}

/// 指し手の行を1つ読む。
///
/// 並びは `指し手 応手 評価値 深さ 選択回数`。後ろの3つは形式として optional で、
/// 同じファイルの中でも行によって欠ける。
///
/// **区切りは1つの空白で数える**（`split_whitespace` ではない）。ShogiHome は
/// score と depth を省くとき空文字を書き出すので、連続した空白を畳むと欄が
/// 1つずつずれ、`深さ 32` が `評価値 +32` として画面に出る。エラーにならないので
/// 誰も気づけない。
///
/// 呼び出し側が空行と注記を除いてから渡すので、先頭のトークンは必ず存在する。
/// 指し手として成立しているかは呼び出し側が [`looks_like_a_move`] で見る。
fn parse_move(line: &str) -> BookMove {
    // 6つ目以降は形式に無い。畳んでおけば、末尾に何か付いていても欄がずれない。
    let mut tokens = line.splitn(6, ' ');

    let usi_move = tokens
        .next()
        .expect("splitn は必ず1つ返す。呼び出し側が空行を除いている")
        .to_string();

    BookMove {
        usi_move,
        ponder: optional_move(tokens.next()),
        value: optional_number(tokens.next()),
        depth: optional_number(tokens.next()),
        count: optional_number(tokens.next()),
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
/// という形だけで、これは実在する綴り（`7g7f` / `P*5e` / `resign` / `none`）を
/// すべて通し、紛れ込んだ日本語・HTML・長いテキストを落とす。
fn looks_like_a_move(token: &str) -> bool {
    !token.is_empty()
        && token.chars().count() <= MAX_MOVE_CHARS
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '*' || c == '+')
}

/// 指し手が無いことを表す綴り。
///
/// 出典: 本家 `source/book/book.cpp:118-119`。`move` と `ponder` の両方で
/// 同じ3綴りを見ている。`none` だけを見ると、`None` や `resign` が
/// **指し手として扱える形**でフロントへ渡る。
const ABSENT_MOVE: [&str; 3] = ["none", "None", "resign"];

/// 応手の欄を読む。省略・空欄・「指し手が無い」の綴りはすべて欠損。
fn optional_move(token: Option<&str>) -> Option<String> {
    let token = token?.trim();
    // 形を満たさない応手は、指し手として渡せないので落とす。ここで落としても
    // 候補手そのものは残るので、定跡が引けなくなることはない。
    if token.is_empty() || ABSENT_MOVE.contains(&token) || !looks_like_a_move(token) {
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
fn optional_number<T: std::str::FromStr>(token: Option<&str>) -> Option<T> {
    token.and_then(|t| t.trim().parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::reader::BookReader;
    use crate::book::sfen::to_book_key;
    use std::path::Path;

    const HIRATE: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

    fn sample() -> String {
        format!(
            "#YANEURAOU-DB2016 1.00\n\
             # NOE:2\n\
             sfen {HIRATE}\n\
             7g7f 3c3d 50 32 1234\n\
             2g2f 8c8d -10 32 567\n\
             sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2\n\
             3c3d none 20 24 99\n"
        )
    }

    /// テストは文字列で書きたいが、本番は1行ずつ読む。同じ `parse` を通す。
    fn parsed(text: &str) -> Result<HashMap<BookKey, Vec<BookMove>>, BookError> {
        parse(std::io::Cursor::new(text.as_bytes()), "/books/a.db")
    }

    fn loaded(text: &str) -> HashMap<BookKey, Vec<BookMove>> {
        parsed(text).expect("読めるはず")
    }

    #[test]
    fn reads_the_moves_of_the_opening_position() {
        let positions = loaded(&sample());
        let key = to_book_key(HIRATE).unwrap();
        let moves = positions.get(&key).expect("初手の局面が入っている");

        assert_eq!(moves.len(), 2);
        assert_eq!(moves[0].usi_move, "7g7f");
        assert_eq!(moves[0].ponder.as_deref(), Some("3c3d"));
        assert_eq!(moves[0].value, Some(50));
        assert_eq!(moves[0].depth, Some(32));
        assert_eq!(moves[0].count, Some(1234));
        assert_eq!(moves[1].usi_move, "2g2f");
        assert_eq!(moves[1].value, Some(-10));
    }

    /// 並び順はファイルのまま保つ。先頭がその局面の best move という約束が
    /// 形式側にあるので、並べ替えると意味が変わる。
    #[test]
    fn keeps_the_order_written_in_the_file() {
        let positions = loaded(&sample());
        let key = to_book_key(HIRATE).unwrap();
        let order: Vec<&str> = positions[&key]
            .iter()
            .map(|m| m.usi_move.as_str())
            .collect();
        assert_eq!(order, ["7g7f", "2g2f"]);
    }

    #[test]
    fn none_becomes_an_absent_ponder() {
        let positions = loaded(&sample());
        let key = to_book_key("lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2")
            .unwrap();
        assert_eq!(positions[&key][0].ponder, None);
    }

    /// 後ろの3つは行ごとに欠ける。欠けた行を捨てると、その局面の候補手が
    /// 黙って減る（未収録と見分けが付かない）。
    #[test]
    fn a_move_without_score_or_depth_is_kept() {
        let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f\n");
        let positions = loaded(&text);
        let moves = &positions[&to_book_key(HIRATE).unwrap()];

        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].usi_move, "7g7f");
        assert_eq!(moves[0].ponder, None);
        assert_eq!(moves[0].value, None);
        assert_eq!(moves[0].depth, None);
        assert_eq!(moves[0].count, None);
    }

    /// 数値として読めない綴りのために、その局面の定跡を丸ごと失わない。
    #[test]
    fn an_unreadable_number_becomes_an_absent_field_not_an_error() {
        let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f 3c3d x 32 1234\n");
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];

        assert_eq!(moves[0].value, None);
        assert_eq!(moves[0].depth, Some(32));
    }

    #[test]
    fn tolerates_crlf() {
        let text = format!("#YANEURAOU-DB2016 1.00\r\nsfen {HIRATE}\r\n7g7f 3c3d 50 32 1234\r\n");
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];
        assert_eq!(moves[0].usi_move, "7g7f");
        assert_eq!(moves[0].count, Some(1234));
    }

    /// `//` は形式の一部のコメント（本家 `book.cpp:710-715`）。
    /// 読み飛ばさないと、先頭の候補手＝best move の位置に `//` が入る。
    #[test]
    fn skips_slash_comments_between_moves() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             sfen {HIRATE}\n\
             // この定跡は floodgate 由来\n\
             7g7f 3c3d 50 32 1\n"
        );
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];

        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].usi_move, "7g7f");
    }

    /// 最初の `sfen` 行より前の `//` を読み飛ばさないと、本家が普通に読める定跡が
    /// 「局面より先に指し手」として丸ごと開けなくなる。
    #[test]
    fn a_slash_comment_before_the_first_position_does_not_break_the_file() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             // 生成: 2026-08-30\n\
             sfen {HIRATE}\n\
             7g7f 3c3d 50 32 1\n"
        );
        assert!(parsed(&text).is_ok());
    }

    /// ShogiHome は score と depth を省くとき空文字を書き出す。連続した空白を
    /// 畳むと欄が1つずつずれ、深さが評価値として画面に出る。
    #[test]
    fn an_empty_field_does_not_shift_the_columns() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             sfen {HIRATE}\n\
             7g7f none  32 5\n\
             2g2f none   1234\n"
        );
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];

        assert_eq!(moves[0].value, None, "空欄を詰めて深さを評価値にしている");
        assert_eq!(moves[0].depth, Some(32));
        assert_eq!(moves[0].count, Some(5));

        assert_eq!(moves[1].value, None);
        assert_eq!(moves[1].depth, None);
        assert_eq!(moves[1].count, Some(1234));
    }

    /// 本家は `none` / `None` / `resign` の3綴りを「指し手が無い」として扱う
    /// （`book.cpp:118-119`）。1つでも取りこぼすと、指し手として扱える形で
    /// フロントへ渡る。
    #[test]
    fn every_spelling_of_an_absent_ponder_is_dropped() {
        for spelling in ["none", "None", "resign"] {
            let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f {spelling} 50 32 1\n");
            let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];
            assert_eq!(moves[0].ponder, None, "spelling={spelling}");
            assert_eq!(moves[0].value, Some(50), "spelling={spelling}");
        }
    }

    /// 指し手が1つも続かない `sfen` 行も1局面として数える。
    ///
    /// `lookup` は未収録と同じ空を返すので、登録をやめても引く側からは見えない。
    /// 見えるのは `position_count` だけで、黙って減る。
    #[test]
    fn a_position_without_moves_is_still_counted() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             sfen {HIRATE}\n\
             sfen 4k4/9/9/9/9/9/9/9/4K4 b - 1\n\
             7g7f 3c3d 50 32 1\n"
        );
        let positions = loaded(&text);

        assert_eq!(positions.len(), 2);
        assert!(positions[&to_book_key(HIRATE).unwrap()].is_empty());
    }

    /// 壊れた行の位置が分からないと、100万行の定跡で利用者にも報告を受けた側にも
    /// 直しようが無い。同じファイルの他の失敗は行番号を出すので、片方だけ嘘をつかない。
    #[test]
    fn a_broken_line_carries_its_line_number() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             sfen {HIRATE}\n\
             7g7f 3c3d 50 32 1\n\
             sfen これは局面ではない\n"
        );
        let err = parsed(&text).unwrap_err();
        assert!(err.message().contains("4行目"), "{}", err.message());
    }

    /// 先頭に空行があるファイルでは、見出しの検査対象は1行目ではない。
    /// 存在しない位置を指す診断を出さない。
    #[test]
    fn the_header_error_points_at_the_line_it_actually_read() {
        let err = parsed("\n\n これは定跡ではない\n").unwrap_err();
        assert!(err.message().contains("3行目"), "{}", err.message());
    }

    /// 改行の無いファイルは1行がファイル全体になる。パス用の打ち切り（4096字）を
    /// 使うと、失敗1回でログの予算を食い潰す。
    #[test]
    fn a_long_first_line_is_cut_to_the_excerpt_budget() {
        let err = parsed(&"x".repeat(10_000)).unwrap_err();
        assert!(
            err.message().chars().count() < 300,
            "len={} message={}",
            err.message().chars().count(),
            &err.message()[..80.min(err.message().len())]
        );
    }

    /// `sfen ` で始まらず注記でもない行は、すべて候補手として登録される。
    /// 検査しないと、ダウンロードが途中で切れて連結された HTML が
    /// `usi_move` としてフロントへ渡る（エラーは一切出ない）。
    #[test]
    fn text_that_is_not_a_move_is_rejected() {
        for garbage in [
            "ここに別のテキストが連結された",
            "<html><body>404 Not Found</body></html>",
            &"x".repeat(5000),
        ] {
            let text =
                format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f 3c3d 50 32 1\n{garbage}\n");
            let err = parsed(&text).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "{garbage:.20}");
            assert!(err.message().contains("4行目"), "{}", err.message());
        }
    }

    /// 実在する綴りは全て通す。一覧で弾くと読めるはずの定跡が開けなくなる。
    #[test]
    fn every_real_move_spelling_is_accepted() {
        for spelling in ["7g7f", "7g7f+", "P*5e", "1a9i", "resign", "none"] {
            let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n{spelling} none 0 0 1\n");
            assert!(parsed(&text).is_ok(), "spelling={spelling}");
        }
    }

    /// 途中で切れたファイルは、自分自身が正しい見出しを持っているのでヘッダの
    /// 検査では止まらない。ファイルが申告する局面数と突き合わせて初めて止まる。
    #[test]
    fn a_truncated_file_is_caught_by_its_own_declared_count() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             # NOE:1250000\n\
             sfen {HIRATE}\n\
             7g7f 3c3d 50 32 1\n"
        );
        let err = parsed(&text).unwrap_err();

        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert!(err.message().contains("1250000"), "{}", err.message());
        assert!(err.message().contains("取得し直す"), "{}", err.message());
    }

    /// 手数違いで2度書かれた局面は1つに畳まれるので、畳んだ後の数と申告は
    /// 一致しない。畳んだ後で突き合わせると、正常な定跡が「途中で切れている。
    /// 取得し直すこと」で拒否される（何度取得し直しても直らない案内になる）。
    #[test]
    fn a_book_with_duplicate_positions_is_not_mistaken_for_a_truncated_one() {
        let text = "#YANEURAOU-DB2016 1.00\n\
             # NOE:2\n\
             sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1\n\
             7g7f none 50 32 1\n\
             sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 31\n\
             2g2f none 40 32 1\n";
        let positions = loaded(text);

        // 畳まれて1局面。申告は2だが、数えているのは sfen 行なので通る
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[&to_book_key(HIRATE).unwrap()].len(), 2);
    }

    /// 申告が合っていれば通る。突き合わせが常に落ちる形になっていないこと。
    #[test]
    fn a_matching_declared_count_is_accepted() {
        let text = format!("#YANEURAOU-DB2016 1.00\n# NOE:1\nsfen {HIRATE}\n7g7f 3c3d 50 32 1\n");
        assert!(parsed(&text).is_ok());
    }

    /// 申告の無い定跡もある。そのときは「局面が1つも無い」を保険にする。
    #[test]
    fn a_book_without_positions_is_rejected() {
        let err = parsed("#YANEURAOU-DB2016 1.00\n").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert!(err.message().contains("取得し直す"), "{}", err.message());
    }

    /// 上限を超えるファイルは1バイトも読まずに落とす。
    ///
    /// `InvalidContent` に混ぜると「壊れている」と読まれ、取得し直すという
    /// 効かない復帰操作へ誘導することになる。種別を分ける。
    #[test]
    fn a_file_over_the_limit_is_refused_before_reading_it() {
        // 実在しないパスを渡す。大きさの検査が先なら open にすら来ない。
        let Err(err) = load(Path::new("/nonexistent/huge.db"), MAX_FILE_BYTES + 1) else {
            panic!("上限を超えたのに開けてしまった");
        };

        assert_eq!(err.code(), BookErrorCode::TooLarge);
        assert!(err.message().contains("512.0MB"), "{}", err.message());
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    /// 上限ちょうどは通す。境界で1バイト間違えると、上限近くの定跡が開けなくなる。
    #[test]
    fn a_file_at_the_limit_is_not_refused_for_its_size() {
        let Err(err) = load(Path::new("/nonexistent/at-limit.db"), MAX_FILE_BYTES) else {
            panic!("存在しないパスなので必ず失敗する");
        };
        assert_ne!(err.code(), BookErrorCode::TooLarge);
    }

    /// 見出しを検査しないと、別形式のファイルが「0局面の定跡」として開ける。
    /// 空の定跡と区別が付かず、利用者は全ての局面が未収録だと受け取る。
    #[test]
    fn rejects_a_file_that_is_not_a_yaneuraou_book() {
        let err = parsed("これは定跡ではない\n7g7f\n").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert_eq!(err.path(), Some("/books/a.db"));
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    #[test]
    fn rejects_an_empty_file() {
        let err = parsed("").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
    }

    /// 途中で切れたファイルは、局面より先に指し手が来る形になる。
    #[test]
    fn rejects_moves_before_any_position() {
        let err = parsed("#YANEURAOU-DB2016 1.00\n7g7f 3c3d 50 32 1\n").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert!(err.message().contains("2行目"), "{}", err.message());
    }

    /// 壊れた `sfen` 行は、利用者が渡した局面の誤りではなくファイルの破損。
    ///
    /// `InvalidSfen` にすると「盤面を操作し直せ」と案内することになり、
    /// 定跡のパスも付かないので、どのファイルを取得し直せばよいか分からない。
    #[test]
    fn a_broken_position_line_is_reported_as_broken_content() {
        let text = "#YANEURAOU-DB2016 1.00\nsfen これは局面ではない\n7g7f\n";
        let err = parsed(text).unwrap_err();

        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert_eq!(err.path(), Some("/books/a.db"));
        assert!(
            err.message().contains("取得し直す"),
            "取得し直す導線が無い: {}",
            err.message()
        );
        assert!(
            !err.message().contains("盤面を操作し直"),
            "利用者の操作の誤りとして案内している: {}",
            err.message()
        );
    }

    /// ファイル側のキーも正規化を通すので、手数や持駒の綴りが違っても引ける。
    /// **通していないと、形式的に正しい定跡が丸ごと引けなくなる。**
    #[test]
    fn a_position_written_with_a_different_move_number_is_still_found() {
        let text = "#YANEURAOU-DB2016 1.00\n\
             sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 99\n\
             7g7f 3c3d 50 32 1\n";
        let positions = loaded(text);
        // 手数 1 で引いても当たる
        assert!(positions.contains_key(&to_book_key(HIRATE).unwrap()));
    }

    /// 局面が2度書かれていても、2つ目にしか無い指し手は捨てない。
    #[test]
    fn merges_a_position_that_appears_twice() {
        let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f\nsfen {HIRATE}\n2g2f\n");
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];
        assert_eq!(moves.len(), 2);
    }

    /// 手数を落とすので `... b - 1` と `... b - 31` は同じキーになる。
    /// 同じ指し手を連ねると評価値違いで2度返り、「先頭が best move」という
    /// 形式の約束が2つのエントリの境目で崩れる。
    #[test]
    fn a_move_written_twice_for_the_same_position_is_kept_once() {
        let text = "#YANEURAOU-DB2016 1.00\n\
             sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1\n\
             7g7f none 50 32 100\n\
             2g2f none 40 32 80\n\
             sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 31\n\
             2g2f none 60 32 9\n\
             3g3f none 10 32 5\n";
        let moves = &loaded(text)[&to_book_key(HIRATE).unwrap()];

        let usi: Vec<&str> = moves.iter().map(|m| m.usi_move.as_str()).collect();
        assert_eq!(usi, ["7g7f", "2g2f", "3g3f"]);
        // 先に読んだ側の値が残る
        assert_eq!(moves[1].value, Some(40));
    }

    #[test]
    fn an_unknown_position_is_empty_not_an_error() {
        let reader = YaneuraouDbReader {
            positions: loaded(&sample()),
        };
        let missing = to_book_key("4k4/9/9/9/9/9/9/9/4K4 b - 1").unwrap();
        assert_eq!(reader.lookup(&missing).unwrap(), Vec::new());
    }

    #[test]
    fn counts_the_positions_it_holds() {
        let reader = YaneuraouDbReader {
            positions: loaded(&sample()),
        };
        assert_eq!(reader.position_count(), 2);
    }

    /// BOM 付きで配られている定跡がある。落とさないと見出しの検査が必ず外れ、
    /// 正しい定跡が「別の形式かもしれない」と拒否される。
    #[test]
    fn tolerates_a_utf8_bom() {
        let dir = std::env::temp_dir().join("obs-shogi-book-bom");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("テスト用のディレクトリを作れない");
        let file = dir.join("book.db");

        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(sample().as_bytes());
        std::fs::write(&file, &bytes).expect("テスト用のファイルを書けない");

        let size = std::fs::metadata(&file).expect("テスト用のファイル").len();
        let result = load(&file, size);
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        let reader = result.expect("BOM 付きでも読めるはず");
        assert_eq!(reader.position_count(), 2);
    }
}
