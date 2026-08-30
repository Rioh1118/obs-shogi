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
//! 大きさの上限は3つ。読む前のファイルサイズ（[`MAX_FILE_BYTES`]）、
//! 1行の長さ（[`MAX_LINE_BYTES`]）、読みながらの展開後の見積もり
//! （[`MAX_EXPANDED_BYTES`]）。**どれが欠けても穴が空く。**
//! 進捗と中断は #197。

use crate::book::error::{BookError, BookErrorCode};
use crate::book::sfen::{excerpt, to_book_key_in_file, BookKey};
use crate::book::types::BookMove;
use std::collections::hash_map::Entry;
use std::collections::HashMap;
use std::collections::HashSet;
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
                "この定跡はこのアプリで開ける大きさを超えている（{} / 上限 {}）。\
                 より小さい定跡を開くこと",
                format_size(size),
                format_size(MAX_FILE_BYTES)
            ),
        )
        .with_path(shown.clone()));
    }

    let file = std::fs::File::open(path).map_err(|e| BookError::from_io(e, shown.clone()))?;
    let positions = parse(std::io::BufReader::new(file), &shown, size)?;
    Ok(YaneuraouDbReader { positions })
}

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
fn read_line<R: BufRead>(
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

    // BOM 付きで配られている定跡がある。落とさないとヘッダの検査が必ず外れる。
    if first && raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    buffer.clear();
    match std::str::from_utf8(raw) {
        Ok(line) => buffer.push_str(line),
        Err(_) => {
            // 注記なら中身を見ない。本家と同じ扱い。
            if is_note(raw) {
                return Ok(Some(terminated));
            }
            return Err(invalid_content(
                &format!(
                    "{line_number}行目に文字として読めないバイトがある。\
                     定跡を取得し直すか、別の定跡を開くこと"
                ),
                path,
            ));
        }
    }

    Ok(Some(terminated))
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

/// 展開後に確保してよいバイト数の見積もり。
///
/// **件数では上界にならない。** 局面だけのファイル（`sfen ` 行が並び、指し手が
/// 0手）は手数を1つも増やさないので、手数の上限に一度も当たらない。実測:
///
/// | ファイル | 局面 | 指し手 | ピーク確保 |
/// | --- | --- | --- | --- |
/// | 831.0 MB | 20,000,000 | 0 | **3.07 GB**（定常値での測定。ピークではない） |
///
/// この形をファイルサイズの上限まで伸ばすと約 5,170 万局面・14 GB を超える。16 GB の機械では、棋譜ツリーとエンジンを抱えたまま
/// スワップに入ってアプリごと落ちる（未保存の棋譜が消える）。
///
/// 単価は [`BYTES_PER_POSITION`] と [`BYTES_PER_MOVE`]。**数字はそちらにだけ置く。**
/// ここへ写すと、単価を直したときにこの説明だけが取り残される。
///
/// **上限を実物の大きさに近づけて置かない。** 版が重なった時点で実利用者が
/// 弾かれ、そのとき出せる復帰操作が無い（この定跡に分割配布は無く、アプリにも
/// 分割機能が無い）。実物が見積もりで 3.32 GB を使うので、2倍の余裕を取って 7 GiB。
///
/// **7 GiB を「安全な量」と読まないこと。** これはメモリへ展開する設計の代価で、
/// 実物1本ですでに 3 GB 前後を使う。8 GB の機械では実物1本でも苦しい。
/// 減らす道は綴りの interning（#274。実測で半分程度）で、上限を下げることではない。
/// 開いている間の進捗と中断は #197。
const MAX_EXPANDED_BYTES: usize = 7 * 1024 * 1024 * 1024;

/// 局面1件あたりの見積もり。
///
/// **ピークで較正する。** 上限が守るのは確保のピークであって、読み終わった後の
/// 定常値ではない。差の出どころは `HashMap` のバケットの空き（要素数の最大2倍）、
/// 拡張中に旧テーブルが生きること、長い列を畳むときの一時領域。
///
/// **測る点は `HashMap` が拡張した直後。** 1点だけで測ると、鋸歯のどこに
/// 乗ったかで倍近く違う値が出る。実測（`peak memory footprint`、正規化後 62 字の
/// キー、aarch64 macOS / release）:
///
/// | 局面 | ピーク | B/局面 |
/// | --- | --- | --- |
/// | 458,752 | 91,411,944 | 199.3（拡張の直前） |
/// | 459,000 | 142,726,680 | **311.0**（拡張の直後） |
/// | 470,000 | 143,717,984 | 305.8 |
/// | 520,000 | 147,711,584 | 284.1 |
///
/// 実物のキーは 76 字前後。確保は 16 バイト刻みなので 64 → 80 で 16 バイト増え、
/// 311.0 + 16 = 327。330 を置く。
const BYTES_PER_POSITION: usize = 330;

/// 指し手1件あたりの見積もり。
///
/// **応手付きで測る。** 応手を省いた行は `String` を1つ確保しないので 2 割ほど
/// 軽く出る。実測（同上。`Vec` が拡張した直後を探した）:
///
/// | 指し手 | B/手 |
/// | --- | --- |
/// | 2,000,000 | **157.2** |
/// | 2,097,200 | 155.2 |
/// | 4,194,400 | 147.0 |
/// | 5,000,000 | 128.9（拡張の直前） |
///
/// 160 を置く。
const BYTES_PER_MOVE: usize = 160;

/// 1行として受け付ける長さの上限。
///
/// 正当な行はどれも短い。`sfen` 行はキーの上限（`sfen.rs` の `MAX_INPUT_CHARS`
/// = 256 字）に前置きを足した程度、指し手行は数十字。自由に伸びるのは注記だけ。
/// 4 KiB あれば実在する定跡には余裕がある。
///
/// **これを掛けないと、改行を1つも含まないファイルで確保が上限を素通りする。**
/// 展開の見積もりは行を受理した後にしか走らないので、行そのものの長さは
/// [`MAX_EXPANDED_BYTES`] の勘定に入らない。
const MAX_LINE_BYTES: usize = 4 * 1024;

/// 開けるファイルの上限。
///
/// **メモリの上界はここではなく [`MAX_EXPANDED_BYTES`] が持つ。** ここは「明らかに定跡で
/// ないものを1バイトも読まずに落とす」ための粗い前段。`.db` は SQLite でも使う
/// 拡張子なので、数 GB のデータベースを選んだときに読み進めないためにある。
///
/// 値は実物から決めた。**配布されている最大の無償定跡 `user_book1.db`
/// （peta_shock 系）が 470.3 MiB / 2,252,118 局面。** その4倍を置く。
/// 512 MiB では実物の 91.9% しかなく、版が重なった時点で実利用者が弾かれる。
/// そのとき出せる復帰操作が無い（この定跡に分割配布は無く、アプリにも
/// 分割機能が無い）ので、近い値を置いてはいけない。
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// 利用者に見せる大きさ。
///
/// **10進で数える。** 上限そのものは 2 の冪で持っているが、利用者が見比べる
/// 相手は Finder / エクスプローラのファイル情報で、そちらは 10 進。
/// 1024 で割った値に `MB` と書くと、同じファイルの数字が食い違う。
///
/// **桁で単位を選ぶ。** 行長（4 KiB）から展開の上限（7 GiB）まで同じ関数に
/// 通すので、`MB` 固定だと 4096 バイトが `0.0MB` になって上限を1つも伝えない。
fn format_size(bytes: u64) -> String {
    const KB: f64 = 1_000.0;
    const MB: f64 = 1_000_000.0;
    const GB: f64 = 1_000_000_000.0;

    let value = bytes as f64;
    if value >= GB {
        format!("{:.1}GB", value / GB)
    } else if value >= MB {
        format!("{:.1}MB", value / MB)
    } else {
        format!("{:.1}KB", value / KB)
    }
}

/// ヘッダの綴り。バージョンは見ない（`1.00` 以外が配られても中身の書式は同じ）。
const HEADER_PREFIX: &str = "#YANEURAOU-DB";

/// 局面行の頭。
const POSITION_PREFIX: &str = "sfen ";

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
    line.is_empty() || is_note(line.as_bytes())
}

/// 注記の行か。**バイト列で見る。** 文字コードの分からない注記を落とす判定に
/// 使うので、`str` に直す前に呼べる必要がある。
///
/// 字下げを許すのは、パーサの他の判定が全て `trim` 済みの行を見ているため。
/// ここだけ生の先頭で見ると、**字下げした注記だけが別の文字コードで拒否される**
/// という説明できない挙動になる。
fn is_note(raw: &[u8]) -> bool {
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
fn declared_count(line: &str) -> Option<u64> {
    line.strip_prefix(DECLARED_COUNT_PREFIX)?
        .trim()
        .parse()
        .ok()
}

/// 本文を局面ごとに畳む。
///
/// **見出しは要求しない。** 本家は検査しないし、見出しの無い `.db` は実在する。
/// 別形式のファイルに `.db` を付けただけのものは、局面行にも注記にもならない行が
/// あるので、そこで落ちる。「0局面の定跡」として開けると空の定跡と見分けが
/// 付かなくなるので、そこは通さない。
fn parse<R: BufRead>(
    reader: R,
    path: &str,
    file_size: u64,
) -> Result<HashMap<BookKey, Vec<BookMove>>, BookError> {
    parse_limited(reader, path, MAX_EXPANDED_BYTES, file_size)
}

/// いま抱えている局面の数。読んでいる最中のものを含む。
fn held_positions(positions: &HashMap<BookKey, Vec<BookMove>>, current: &Option<BookKey>) -> usize {
    positions.len() + usize::from(current.is_some())
}

/// 展開の見積もりが上限を超えていないか。
///
/// 局面と指し手の両方を数える。**片方だけだと、もう片方だけのファイルが
/// 素通りする。**
fn check_expanded_size(
    positions: usize,
    moves: usize,
    max_bytes: usize,
    file_size: u64,
    consumed: u64,
    path: &str,
) -> Result<(), BookError> {
    let estimated = positions * BYTES_PER_POSITION + moves * BYTES_PER_MOVE;
    if estimated <= max_bytes {
        return Ok(());
    }

    // **展開の上限そのものは出さない。** ファイルの上限（`MAX_FILE_BYTES`）は
    // 展開の上限より小さいので、その2つを並べると必ず「小さいファイルが大きい
    // 上限を超えた」と読める。利用者はアプリの不具合だと判断するか、
    // 「上限まで余裕がある」と逆方向へ動く。
    //
    // 出すのは同じ量どうし。**上限に当たった時点で読めていたバイト数**が、
    // この形の定跡なら開ける大きさそのものになる。
    Err(BookError::new(
        BookErrorCode::TooLarge,
        format!(
            "この定跡は展開するとメモリに収まらない（{} のうち先頭 {} を読んだ\
             ところで上限）。この形の定跡なら {} 程度までにすること",
            format_size(file_size),
            format_size(consumed),
            format_size(consumed)
        ),
    )
    .with_path(path))
}

/// 展開後の上限（[`MAX_EXPANDED_BYTES`]）を差し替えられる形。
/// テストが 7 GiB ぶんの入力を組まずに済むように分ける。ファイルサイズの上限
/// （[`MAX_FILE_BYTES`]）はここでは見ない。
fn parse_limited<R: BufRead>(
    mut reader: R,
    path: &str,
    max_bytes: usize,
    file_size: u64,
) -> Result<HashMap<BookKey, Vec<BookMove>>, BookError> {
    let mut buffer = String::new();
    // 行ごとに作り直さない。実物の定跡で 1,800 万回超の確保になる
    // （局面 225 万行 + 指し手 1,610 万行）。
    let mut raw = Vec::new();
    let mut index = 0usize;
    let mut header: Option<usize> = None;
    let mut declared: Option<u64> = None;
    let mut last_line_terminated = true;
    let mut dropped = DroppedFields::default();
    // 見出しの無い定跡では、見出しを探す間に読んだ局面行がそのまま本体の1行目に
    // なる。読み直せないので、本体のループはまず `buffer` の中身から始める。
    let mut unread = false;

    // 見出しより前にも注記は書ける。本家は `#` と `//` を位置に関係なく
    // 読み飛ばす（`book.cpp:709-716`）ので、先頭の1行のせいで定跡を拒否しない。
    while let Some(terminated) = read_line(
        &mut reader,
        &mut raw,
        &mut buffer,
        index == 0,
        index + 1,
        path,
    )? {
        index += 1;
        last_line_terminated = terminated;
        let line = buffer.trim();
        if line.is_empty() {
            continue;
        }
        // **`is_skippable` より先に見る。** `# NOE:` は注記の形をしているので、
        // 順序を入れ替えると申告値を取り逃し、切れの検出が丸ごと消える。
        if let Some(count) = declared_count(line) {
            declared = Some(count);
            continue;
        }
        if line.starts_with(HEADER_PREFIX) {
            header = Some(index);
            break;
        }
        if is_skippable(line) {
            continue;
        }
        // 見出しの無い `.db` は実在する。ShogiHome は `yaneuraou-no-header.db` を
        // **開ける側**の回帰 fixture に置いているし、本家は見出しを検査しない。
        // 局面行に当たったらそこが本体の始まり。読み捨てずに本体へ渡す。
        if line.starts_with(POSITION_PREFIX) {
            header = Some(index);
            unread = true;
            break;
        }
        // 局面でも注記でも見出しでもない行に当たった。ここで定跡ではないと決まる。
        return Err(invalid_content(
            &format!(
                "やねうら王テキスト定跡として読めない（{index}行目: {}）。\
                 別の形式のファイルかもしれない。取得し直すか、別の定跡を開くこと",
                excerpt(line)
            ),
            path,
        ));
    }

    if header.is_none() {
        return Err(invalid_content(
            "定跡ファイルが空。取得し直すか、別の定跡を開くこと",
            path,
        ));
    }

    let mut positions: HashMap<BookKey, Vec<BookMove>> = HashMap::new();
    let mut current: Option<BookKey> = None;
    // 現在の局面ぶんを溜める。行ごとに map を引くと、指し手1行につきキーの確保と
    // ハッシュ計算が1回ずつ走る（100MB の定跡で 312 万回、パース時間の 17%）。
    let mut buffered: Vec<BookMove> = Vec::new();
    // 申告と突き合わせるのは `sfen` 行の数。map の要素数ではない（正規化と
    // 重複の畳み込みで減るので、正常な定跡でも一致しない）。
    let mut sfen_lines: u64 = 0;
    // 上限に当たった時点までに、本体のループが読んだ量。文面ではファイルの
    // 大きさと並べる（理由は `check_expanded_size` の中のコメント）。
    // 見出しより前と、読み捨てた注記の本体は含まない。
    let mut consumed: u64 = 0;
    let mut total_moves: usize = 0;

    loop {
        if unread {
            // 見出しを探す間に読んだ行。`index` はそのとき既に進めてある。
            unread = false;
        } else {
            match read_line(&mut reader, &mut raw, &mut buffer, false, index + 1, path)? {
                Some(terminated) => {
                    index += 1;
                    last_line_terminated = terminated;
                }
                None => break,
            }
        }
        let terminated = last_line_terminated;
        consumed += raw.len() as u64 + 1;
        let line = buffer.trim();
        if is_skippable(line) {
            // 注記や空行で終わるファイルは、切れていても失われたのは注記だけ。
            // ここで上書きすると、完全な定跡を「ダウンロードが途中で切れた」と
            // 診断する。見るのはデータの行だけ。
            last_line_terminated = true;
            if let Some(count) = declared_count(line) {
                declared = Some(count);
            }
            continue;
        }

        last_line_terminated = terminated;

        if let Some(rest) = line.strip_prefix("sfen ") {
            sfen_lines += 1;
            // 局面だけのファイルは手数を1つも増やさないので、指し手の側の
            // 検査に一度も当たらない。ここでも見る。
            check_expanded_size(
                held_positions(&positions, &current),
                total_moves,
                max_bytes,
                file_size,
                consumed,
                path,
            )?;
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

        let parsed = parse_move(line, &mut dropped);
        // 「指し手が無い」の綴り。本家は指し手の欄でも同じ3綴りを見る
        // （`book.cpp:118-119`）。候補手にすると、盤に適用できない綴りが
        // 先頭＝best move の位置に座る。局面は `flush` が空でも登録する。
        if ABSENT_MOVE.contains(&parsed.usi_move.as_str()) {
            continue;
        }
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
        total_moves += 1;
        // 読んでいる最中の局面はまだ `positions` に入っていない（`flush` は次の
        // `sfen` 行か EOF で走る）。数え漏らすと、1局面だけのファイルで
        // 局面ぶんが丸ごと見積もりから落ちる。
        check_expanded_size(
            held_positions(&positions, &current),
            total_moves,
            max_bytes,
            file_size,
            consumed,
            path,
        )?;
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
    }

    // 最終行が改行で終わらないことは、**切れの根拠にならない。** 両方向に外れる。
    //
    // - 拒否の側: 本家は末尾の改行を要求しない（`book.cpp:705` の
    //   `while (reader.ReadLine(line).is_ok())`）。改行が無いだけの完全な定跡を
    //   拒否すると、表の不変条件1（本家が読めるものは読める）と3（正しい
    //   ファイルを拒否しない）の両方を破る。しかも復帰操作「末尾に改行を足す」は
    //   470MB のファイルでは編集ソフトが開けない
    // - 見逃しの側: 行境界でちょうど切れたファイルは素通りする。行単位で書き出す
    //   生成器がディスク満杯や kill で止まった場合は**必ず**行境界で終わるので、
    //   その経路は 100% 検出できない
    //
    // 事実として記録し、判断は利用者に残す。局面数は `BookInfo` に載るので、
    // 配布元の申告と突き合わせられる。
    if !last_line_terminated {
        log::warn!(
            "[book] 定跡ファイルが改行で終わっていない path={} 局面数={}",
            crate::book::error::truncate_path(path),
            positions.len()
        );
    }

    keep_first_of_each_move_everywhere(&mut positions);

    if positions.is_empty() {
        return Err(invalid_content(
            "定跡ファイルに局面が1つも書かれていない。途中で切れているかもしれない。\
             取得し直すか、別の定跡を開くこと",
            path,
        ));
    }

    if dropped.ponder > 0 || dropped.numbers > 0 {
        log::warn!(
            "[book] 読めない欄を読み飛ばした path={} 応手={} 数値={}",
            crate::book::error::truncate_path(path),
            dropped.ponder,
            dropped.numbers
        );
    }

    Ok(positions)
}

/// 溜めた指し手を、いまの局面のものとして確定させる。
///
/// **指し手が1つも続かなかった `sfen` 行も、空の `Vec` で登録する。**
/// `lookup` は未収録と同じ空を返すが、`position_count` はこれを数える。
/// 消すと収録局面数だけが黙って減り、テストは全部緑のまま通る。
///
/// 容量はここでは縮めない。畳んだ後に一括で縮める。
fn flush(
    positions: &mut HashMap<BookKey, Vec<BookMove>>,
    current: &mut Option<BookKey>,
    buffered: &mut Vec<BookMove>,
) {
    let Some(key) = current.take() else {
        // `current` が `None` なら `buffered` も空。局面より先の指し手は
        // `parse` が先にエラーにしている。破ると溜めた指し手が黙って消える。
        debug_assert!(buffered.is_empty());
        return;
    };

    // **ここでは畳まない。** 理由と実測は `keep_first_of_each_move_everywhere` の doc。
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
        // 2つのエントリの境目で崩れる。
        //
        // 本家 `BookMoves::insert`（`book.cpp:123-149`）も、同じ指し手があれば
        // 追加しない。ShogiHome は違う方針（手数の小さいエントリで丸ごと置換）
        // なので、同じ入力でも候補手の数が違う。
        Entry::Occupied(mut slot) => slot.get_mut().append(buffered),
    }
}

/// 読み切った後に1回だけ、全ての局面の重複を畳む。
///
/// **併合のたびに畳んではいけない。** 1回の仕事が `existing.len()` に比例するので、
/// 同じキーが N ブロックに分かれた定跡で総計が二乗になる。実測（同じキーを
/// N ブロック、各1手）:
///
/// | N | 併合のたびに畳む | 読み切った後に1回 |
/// | --- | --- | --- |
/// | 10,000 | 18.8 s | 0.34 s |
/// | 40,000 | 412 s | 38.9 s |
///
/// 畳む前は重複を抱えたままになるが、その量は [`MAX_EXPANDED_BYTES`] が
/// `total_moves` の側で上界を持つ。
///
/// 畳んでから `shrink_to_fit` を掛ける。`push` の倍々成長が残す空き容量は、
/// 実測で展開後の 28%。
fn keep_first_of_each_move_everywhere(positions: &mut HashMap<BookKey, Vec<BookMove>>) {
    for moves in positions.values_mut() {
        keep_first_of_each_move(moves);
        moves.shrink_to_fit();
    }
}

/// 同じ綴りの指し手を、先に来た方だけ残す。
///
/// **走査で畳むのは短い列のときだけ。** 1局面の候補手は普通10手前後なので、
/// そこで `HashSet` を作ると確保が局面の数だけ増える（実物の定跡で 225 万回）。
/// 一方、同じ局面が延々と繰り返されるファイルでは列が伸びて走査が二乗になる。
/// 実測で 6.22MB のファイルに 16 秒かかり、100MB なら 70 分を超える
/// （`open_book` は `spawn_blocking` の中で進捗も中断も持たないので、
/// アプリは無反応のまま戻らない）。長い列だけ `HashSet` へ切り替える。
fn keep_first_of_each_move(moves: &mut Vec<BookMove>) {
    /// 走査と `HashSet` の切り替え点。1局面の候補手がこれを超えるのは異常な形。
    const SCAN_LIMIT: usize = 32;

    if moves.len() <= SCAN_LIMIT {
        let mut kept = 0usize;
        for i in 0..moves.len() {
            if moves[..kept]
                .iter()
                .any(|m| m.usi_move == moves[i].usi_move)
            {
                continue;
            }
            moves.swap(kept, i);
            kept += 1;
        }
        moves.truncate(kept);
        return;
    }

    // 綴りを clone せず、添字だけ持つ。畳む対象が長い列なので、ここで
    // 要素数ぶんの `String` を確保すると畳む意味が薄れる。
    let mut seen: HashSet<&str> = HashSet::with_capacity(moves.len());
    let mut keep = Vec::with_capacity(moves.len());
    for m in moves.iter() {
        keep.push(seen.insert(m.usi_move.as_str()));
    }
    let mut kept = keep.into_iter();
    moves.retain(|_| kept.next().unwrap_or(false));
}

/// 読めずに捨てた欄の数。
///
/// 落とした事実がどこにも出ないと、誤読みだと分かる手がかりが利用者にも
/// 報告を受けた側にも無い。行ごとに `log` を出すと 100 万行でログが溢れるので、
/// 数えて最後に1回だけ出す。
#[derive(Default)]
struct DroppedFields {
    ponder: usize,
    numbers: usize,
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
fn parse_move(line: &str, dropped: &mut DroppedFields) -> BookMove {
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
fn looks_like_a_move(token: &str) -> bool {
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
/// 出典: 本家 `source/book/book.cpp:118-119`。**指し手の欄と応手の欄の両方**で
/// 同じ3綴りを見る。片方だけに当てると、盤に適用できない綴りが
/// 候補手の先頭＝best move の位置に座る。
///
/// **評価値と深さの欄にも当てる。** ShogiHome はこの2つを省くとき `none` を
/// 書き出す（`src/background/book/yaneuraou.ts` の `SCORE_NONE` / `DEPTH_NONE`。
/// 空文字は v1.20.0 までの書き方で、「やねうら王や BookConv は連続するスペースを
/// まとめて読み込む」ため非推奨になった）。当てないと `7g7f none none none 103`
/// という**現行の標準的な行**が数値欄2つぶんの欠損として数えられ、正常な定跡が
/// 指し手の数より多い欠損を報告する。
const ABSENT_MOVE: [&str; 3] = ["none", "None", "resign"];

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
        parse(
            std::io::Cursor::new(text.as_bytes()),
            "/books/a.db",
            text.len() as u64,
        )
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

    /// 引用は引用の予算で打ち切る。パス用の打ち切り（4096字）を使うと、
    /// 1行が上限いっぱいの定跡で、失敗1回がログの予算を食い潰す。
    ///
    /// **入力は行長の上限より短くすること。** 超えると `read_line` の側で
    /// 「長すぎる」に落ち、引用の経路を1バイトも通らない。実際そう書いていて、
    /// パス用の打ち切りへ差し替える変異が緑で通っていた。
    #[test]
    fn a_long_line_is_cut_to_the_excerpt_budget() {
        let err = parsed(&"x".repeat(3000)).unwrap_err();
        let message = err.message();

        assert!(
            message.contains('…'),
            "打ち切りの跡が無い（引用を通っていない）: {message}"
        );
        assert!(
            message.chars().count() < 300,
            "len={} message={message}",
            message.chars().count(),
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
            // 行長の上限より短くすること。超えると `read_line` の側で
            // 「長すぎる」に落ち、指し手として読む経路まで届かない。
            &"x".repeat(3000),
        ] {
            let text =
                format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f 3c3d 50 32 1\n{garbage}\n");
            let err = parsed(&text).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "{garbage:.20}");
            let message = err.message();
            assert!(message.contains("4行目"), "{message}");
            assert!(message.contains("指し手として読めない"), "{message}");
        }
    }

    /// 実在する綴りは全て候補手になる。一覧で弾くと読めるはずの定跡が開けなくなる。
    ///
    /// 「指し手が無い」の綴り（`none` / `resign`）はここに入れない。形は満たすが
    /// 候補手にはならないので、`an_absent_move_spelling_is_not_a_candidate` が見る。
    #[test]
    fn every_real_move_spelling_becomes_a_candidate() {
        for spelling in ["7g7f", "7g7f+", "P*5e", "1a9i"] {
            let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n{spelling} none 0 0 1\n");
            let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];
            assert_eq!(moves.len(), 1, "spelling={spelling}");
            assert_eq!(moves[0].usi_move, spelling);
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
        assert!(
            err.message().contains(&format_size(MAX_FILE_BYTES)),
            "{}",
            err.message()
        );
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    /// 利用者が見比べる相手は Finder / エクスプローラのファイル情報で、そちらは
    /// 10 進。1024 で割った値に `MB` と書くと、同じファイルの数字が食い違う。
    ///
    /// 定数と突き合わせない。`format_size(MAX_FILE_BYTES)` と比べると、関数を
    /// 変えたときに両辺が同じだけ動いて、食い違いを見逃す。
    #[test]
    fn sizes_are_shown_in_the_same_unit_as_the_file_manager() {
        assert_eq!(format_size(1_000_000), "1.0MB");
        assert_eq!(format_size(493_157_464), "493.2MB");
        // 行長（4 KiB）から展開の上限（7 GiB）まで同じ関数に通す。MB 固定だと
        // 4096 バイトが 0.0MB になり、上限を1つも伝えない文面になる。
        assert_eq!(format_size(4096), "4.1KB");
        assert_eq!(format_size(6 * 1024 * 1024 * 1024), "6.4GB");
    }

    /// 上限ちょうどは通す。境界で1バイト間違えると、上限近くの定跡が開けなくなる。
    #[test]
    fn a_file_at_the_limit_is_not_refused_for_its_size() {
        let Err(err) = load(Path::new("/nonexistent/at-limit.db"), MAX_FILE_BYTES) else {
            panic!("存在しないパスなので必ず失敗する");
        };
        assert_ne!(err.code(), BookErrorCode::TooLarge);
    }

    /// 表の (S0, E3) / (S0, E4) / (S0, E2)。
    ///
    /// 本家は `#` と `//` を位置に関係なく読み飛ばす（`book.cpp:709-716`）。
    /// 見出しより前の1行のせいで、本家が普通に読める定跡を拒否しない。
    #[test]
    fn notes_before_the_header_are_skipped() {
        for lead in ["// generated 2026-08-30", "# yaneuraou", "# NOE:1", ""] {
            let text =
                format!("{lead}\n#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f none 50 32 1\n");
            assert!(parsed(&text).is_ok(), "lead={lead:?}");
        }
    }

    /// 表の (S2, E6)。本家は指し手の欄でも `none` / `None` / `resign` を
    /// 「指し手が無い」として扱う（`book.cpp:118-119`）。候補手にすると、
    /// 盤に適用できない綴りが先頭＝best move の位置に座る。
    #[test]
    fn an_absent_move_spelling_is_not_a_candidate() {
        for spelling in ["none", "None", "resign"] {
            let text = format!(
                "#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n{spelling} none 0 0 1\n7g7f none 50 32 1\n"
            );
            let positions = loaded(&text);
            let moves = &positions[&to_book_key(HIRATE).unwrap()];

            let usi: Vec<&str> = moves.iter().map(|m| m.usi_move.as_str()).collect();
            assert_eq!(usi, ["7g7f"], "spelling={spelling}");
            // 局面そのものは数える
            assert_eq!(positions.len(), 1, "spelling={spelling}");
        }
    }

    /// 表の (S0, E6) / (S0, E7)。局面より先に来た指し手は、見出しの有無に
    /// かかわらず落ちる。
    #[test]
    fn a_move_before_any_position_is_rejected_without_a_header() {
        for line in ["resign none 0 0 1", "7g7f 3c3d 50 32 1"] {
            let err = parsed(&format!("{line}\n")).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "line={line}");
            assert!(
                err.message().contains("読めない"),
                "line={line} message={}",
                err.message()
            );
        }
    }

    /// 表の (S0, E5)。見出しの無い定跡も読む。
    ///
    /// **ShogiHome は `yaneuraou-no-header.db` を「開ける」側の回帰 fixture に
    /// 置いている。** 本家も見出しを検査しない。拒否すると、正しい定跡に対して
    /// 「別の形式のファイルかもしれない」と言いながら、引用する行は誰が見ても
    /// やねうら王の局面行、という自己矛盾した案内になる。
    ///
    /// 見出しを探す間に読んだ局面行は読み直せないので、そのまま本体へ渡すこと。
    /// 捨てると、見出しの無い定跡だけ先頭の1局面が消える。
    #[test]
    fn a_book_without_a_header_is_read() {
        // ShogiHome の fixture と同じ形。BOM 付きも同じ扱い。
        for lead in ["", "\u{feff}"] {
            let text = format!(
                "{lead}sfen {HIRATE}\n\
                 2b8h+ none none none 103\n\
                 sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2\n\
                 3c3d none none none 3\n"
            );
            let positions = loaded(&text);

            assert_eq!(positions.len(), 2, "lead={lead:?}");
            let moves: Vec<&str> = positions
                .values()
                .flatten()
                .map(|m| m.usi_move.as_str())
                .collect();
            assert_eq!(moves.len(), 2, "lead={lead:?} moves={moves:?}");
            assert!(moves.contains(&"2b8h+"), "lead={lead:?} moves={moves:?}");
        }
    }

    /// 見出しが無くても、定跡ではないファイルは落ちること。
    ///
    /// 見出しの検査を外した理由は「正しい定跡を拒否しない」であって、
    /// 「何でも開く」ではない。別形式のファイルが「0局面の定跡」として開けると、
    /// 空の定跡と見分けが付かなくなる。
    #[test]
    fn a_file_that_is_not_a_book_still_fails_without_a_header() {
        for text in [
            "<!DOCTYPE html>\n<html><body>404</body></html>\n",
            "not a book\n",
            // 注記だけ。局面が1つも無い
            "# ここには何も無い\n// 何も無い\n",
        ] {
            let err = parsed(text).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "text={text:.20}");
        }
    }

    /// 表の (S0, E2)。見出しより前の `# NOE:` も申告値として覚える。
    ///
    /// **注記として読み飛ばすだけでは足りない。** `# NOE:` は注記の形をして
    /// いるので、`is_skippable` を先に見る順序へ変えると値を取り逃し、
    /// 切れの検出が黙って消える。読み飛ばしだけを見るテストでは、その入れ替えが
    /// 緑で通る。
    #[test]
    fn a_declared_count_before_the_header_still_catches_a_truncated_file() {
        let text = format!("# NOE:1250000\n#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f\n");
        let err = parsed(&text).unwrap_err();

        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert!(
            err.message().contains("1250000"),
            "申告値を取り逃している: {}",
            err.message()
        );
    }

    /// 表の (S1, E6) / (S1, E8)。局面より先に来た行は、指し手の形を満たすかに
    /// かかわらず同じ枝へ落ちる。
    #[test]
    fn any_line_before_the_first_position_is_rejected_the_same_way() {
        for line in [
            "7g7f none 50 32 1",
            "resign none 0 0 1",
            "ここに別のテキスト",
        ] {
            let text = format!("#YANEURAOU-DB2016 1.00\n{line}\n");
            let err = parsed(&text).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "line={line}");
            assert!(
                err.message().contains("局面より先に指し手"),
                "line={line} message={}",
                err.message()
            );
        }
    }

    /// 表の (S1, E1) / (S2, E1) / (S2, E2)。2度目の見出しと、途中の `# NOE:` は
    /// 注記と同じ扱い。
    #[test]
    fn a_second_header_and_a_late_note_are_treated_as_notes() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             sfen {HIRATE}\n\
             #YANEURAOU-DB2016 1.00\n\
             7g7f none 50 32 1\n\
             # NOE:1\n\
             2g2f none 40 32 1\n"
        );
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];
        let usi: Vec<&str> = moves.iter().map(|m| m.usi_move.as_str()).collect();
        assert_eq!(usi, ["7g7f", "2g2f"]);
    }

    /// 表の F1。**注記の中身は見ない。** 本家は行を生のバイト列として読み、
    /// `#` / `//` を中身を見ずに捨てる。ファイル全体を UTF-8 として読むと、
    /// Shift_JIS の注記が1行あるだけで定跡全体が拒否される。
    #[test]
    fn a_note_in_another_encoding_does_not_reject_the_book() {
        let mut bytes = b"#YANEURAOU-DB2016 1.00\n// ".to_vec();
        // cp932 の「生成」
        bytes.extend_from_slice(&[0x90, 0xB6, 0x90, 0xAC]);
        bytes.extend_from_slice(b"\n");
        bytes.extend_from_slice(format!("sfen {HIRATE}\n7g7f none 50 32 1\n").as_bytes());

        let positions = parse(std::io::Cursor::new(bytes), "/books/a.db", 0).expect("読めるはず");
        assert_eq!(positions.len(), 1);
    }

    /// 注記でない行が読めないときは落とす。**行番号を添える。**
    /// 100万行の定跡で「どこか」としか言われないと、利用者にも報告を受けた側にも
    /// 打つ手が無い。同じファイルの他の失敗は行番号を出すので、ここだけ揃えない
    /// 理由が無い。
    #[test]
    fn an_unreadable_byte_outside_a_note_is_reported_with_its_line_number() {
        let mut bytes =
            format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f none 50 32 1\n").into_bytes();
        bytes.extend_from_slice(&[0x80, b'\n']);

        let err = parse(std::io::Cursor::new(bytes), "/books/a.db", 0).unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert!(err.message().contains("4行目"), "{}", err.message());
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    /// `sfen` 行の途中で切れたファイルでは、形式のキーワードが指し手の位置に来る。
    /// 形は満たすので、綴りで外さないと候補手に入る。
    #[test]
    fn the_sfen_keyword_is_not_a_candidate_move() {
        assert!(!looks_like_a_move("sfen"));
        assert!(looks_like_a_move("7g7f"));
    }

    /// 落とした欄の数を数えていること。数えていないと、誤読みだと分かる
    /// 手がかりが利用者にも報告を受けた側にも無い。
    #[test]
    fn dropped_fields_are_counted() {
        let mut dropped = DroppedFields::default();
        // 応手が指し手の形を満たさない / 評価値が数値でない
        let parsed = parse_move("7g7f ここには指し手が来るはず x 32 1", &mut dropped);

        assert_eq!(parsed.usi_move, "7g7f");
        assert_eq!(parsed.ponder, None);
        assert_eq!(parsed.value, None);
        assert_eq!(dropped.ponder, 1);
        assert_eq!(dropped.numbers, 1);
    }

    /// 省略された欄は「読めなかった」ではないので数えない。数えると、正常な定跡で
    /// 毎回ログが出て、本当に読めなかった場合と区別が付かなくなる。
    ///
    /// **`none` を含めること。** 空欄だけを見ていると、ShogiHome が書き出す
    /// 現行の綴り（`7g7f none none none 103`）が数値欄2つぶんの欠損として
    /// 数えられる。実物の `yaneuraou.db`（指し手19行）で欠損 20件という、
    /// 指し手より多い件数が出ていた。
    #[test]
    fn an_omitted_field_is_not_counted_as_dropped() {
        for line in [
            // v1.20.0 までの ShogiHome
            "7g7f none  32 5",
            // 現行の ShogiHome
            "7g7f none none none 103",
        ] {
            let mut dropped = DroppedFields::default();
            parse_move(line, &mut dropped);

            assert_eq!(dropped.ponder, 0, "line={line}");
            assert_eq!(dropped.numbers, 0, "line={line}");
        }
    }

    /// **実在する最大の定跡が、どちらの上限にも余裕を持って収まること。**
    ///
    /// 上限を実物に近づけると、版が重なった時点で実利用者が弾かれる。そのとき
    /// 出せる復帰操作が無い（この定跡に分割配布は無く、アプリにも分割機能が無い）。
    ///
    /// 配布されている `user_book1.db`（peta_shock 系）の実測（`parse` と同じ数え方）。
    /// 実行時ではなくコンパイル時に見るので、上限を実物へ近づけた時点で止まる。
    ///
    /// **この値が実測と合っているかは機械では守れない。** 上限に余裕がある間は、
    /// 間違った数を書いても assert が通る。出典は
    /// `docs/state-transitions/yaneuraou-db-parse.md` の一次資料の表。
    const REAL_BOOK_BYTES: u64 = 493_157_464; // 470.3 MiB
    const REAL_BOOK_POSITIONS: usize = 2_252_118;
    const REAL_BOOK_MOVES: usize = 16_097_817; // 1局面あたり 7.15 手

    /// **どちらの上限にも2倍の余裕を要求する。** 実物に近い値を置くと、
    /// 版が重なった時点で実利用者が弾かれ、そのとき出せる復帰操作が無い。
    /// ファイルの上限は展開の上限より小さい。**この向きが変わると、`check_expanded_size`
    /// が「ファイルの大きさ」と「展開の上限」を並べても矛盾して見えなくなる**ので、
    /// 文面の作り方を見直す合図になる。
    const _: () = assert!(MAX_FILE_BYTES < MAX_EXPANDED_BYTES as u64);

    const _: () = assert!(REAL_BOOK_BYTES * 2 < MAX_FILE_BYTES);
    const _: () = assert!(
        (REAL_BOOK_POSITIONS * BYTES_PER_POSITION + REAL_BOOK_MOVES * BYTES_PER_MOVE) * 2
            < MAX_EXPANDED_BYTES
    );

    /// `# NOE:0` と書いたファイルで「0局面は成立しない」の保険を迂回しない。
    /// 申告の側にぶら下げると、31 バイトのファイルが成功する。
    #[test]
    fn a_declared_count_of_zero_does_not_bypass_the_empty_check() {
        let err = parsed("#YANEURAOU-DB2016 1.00\n# NOE:0\n").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert!(err.message().contains("局面が1つも"), "{}", err.message());
    }
    /// 同じキーが N ブロックに分かれた定跡で、併合が二乗にならないこと。
    ///
    /// **`a_position_with_very_many_moves_is_still_deduped` では踏めない。**
    /// あちらは1ブロックに多くの手を置くので、走査と `HashSet` の分岐しか見ない。
    #[test]
    fn a_position_split_across_many_blocks_is_not_quadratic() {
        const BLOCKS: usize = 5_000;

        let mut text = String::from("#YANEURAOU-DB2016 1.00\n");
        for i in 0..BLOCKS {
            text.push_str(&format!("sfen {HIRATE}\n"));
            // 相異なる手を1つずつ。畳んだ後は BLOCKS 手になる
            let file = (i % 9) + 1;
            let rank = (b'a' + (i / 9 % 9) as u8) as char;
            let to_file = (i / 81 % 9) + 1;
            let to_rank = (b'a' + (i / 729 % 9) as u8) as char;
            text.push_str(&format!("{file}{rank}{to_file}{to_rank} none 0 0 1\n"));
        }

        let started = std::time::Instant::now();
        let positions = loaded(&text);
        let elapsed = started.elapsed();

        assert_eq!(positions.len(), 1);

        // 時間で見るので、機械差を吸収できるだけ差を開けてある。
        // 実測: 併合のたびに畳む形で 4.70s、読み切った後に1回で 0.10s（47倍）。
        // 閾値の 2 秒は、速い側の 20 倍・遅い側の半分以下。
        assert!(elapsed.as_secs() < 2, "併合が二乗になっている: {elapsed:?}");
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

    /// 字下げした注記が別の文字コードでも、定跡全体を拒否しない。
    #[test]
    fn an_indented_note_in_another_encoding_does_not_reject_the_book() {
        for lead in ["", "  ", "\t"] {
            let mut bytes = b"#YANEURAOU-DB2016 1.00\n".to_vec();
            bytes.extend_from_slice(lead.as_bytes());
            bytes.extend_from_slice(b"// ");
            bytes.extend_from_slice(&[0x90, 0xB6, 0x90, 0xAC]); // cp932 の「生成」
            bytes.extend_from_slice(b"\n");
            bytes.extend_from_slice(format!("sfen {HIRATE}\n7g7f none 50 32 1\n").as_bytes());

            let result = parse(std::io::Cursor::new(bytes), "/books/a.db", 0);
            assert!(result.is_ok(), "lead={lead:?}");
        }
    }

    /// **末尾の改行は要求しない。** 本家は `while (reader.ReadLine(line).is_ok())`
    /// で読むので、改行が無いだけの完全な定跡を普通に読む。拒否すると表の
    /// 不変条件1（本家が読めるものは読める）と3（正しいファイルを拒否しない）を
    /// 同時に破る。
    ///
    /// 切れの検出には使えない。行境界でちょうど切れたファイルは素通りし、
    /// 行単位で書き出す生成器が止まった場合は**必ず**行境界で終わる。
    #[test]
    fn a_complete_book_without_a_final_newline_is_accepted() {
        let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f none 50 32 1");
        let positions = parsed(&text).expect("改行が無いだけの完全な定跡");
        assert_eq!(positions.len(), 1);
    }

    /// 注記や空行で終わるファイルも同じ。
    #[test]
    fn a_book_ending_with_a_note_and_no_newline_is_accepted() {
        for tail in ["# 生成: 2026-08-30", "// 出典: floodgate", "   "] {
            let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f none 50 32 1\n{tail}");
            assert!(parsed(&text).is_ok(), "tail={tail:?}");
        }
    }

    /// 切れの検出は申告との突き合わせだけが担う。**改行の有無で無効にしない。**
    /// `# NOE:` を1行足すだけで検出が消えると、手で編集して申告が古くなった
    /// 定跡のダウンロードが切れたときに、静かに「小さい定跡」として開く。
    #[test]
    fn a_declared_count_still_catches_a_truncated_file() {
        for tail in ["", "\n"] {
            let text = format!(
                "#YANEURAOU-DB2016 1.00\n# NOE:1250000\nsfen {HIRATE}\n7g7f none 50 32 1{tail}"
            );
            let err = parsed(&text).unwrap_err();
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "tail={tail:?}");
            assert!(err.message().contains("1250000"), "{}", err.message());
        }
    }

    /// 上限ちょうどは通す。境界で間違えると、上限近くの定跡が開けなくなる。
    ///
    /// 上限は単価から組む。**見ているのは単価ではなく `<=` と `<` の別**なので、
    /// 単価を直すたびにこの数字を直させるのは、境界の意味と関係の無い作業。
    #[test]
    fn a_book_at_the_expansion_limit_is_accepted() {
        let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f\n2g2f\n3g3f\n");
        let exactly = BYTES_PER_POSITION + 3 * BYTES_PER_MOVE;
        assert!(parse_limited(
            std::io::Cursor::new(text.as_bytes()),
            "/books/a.db",
            exactly,
            text.len() as u64
        )
        .is_ok());
    }

    /// **局面だけのファイルも上限に当たること。** 指し手を1つも増やさないので、
    /// 手数だけを数える形では一度も当たらない（実測で 831MB のファイルが
    /// 3.07 GB を確保して成功していた）。
    #[test]
    fn a_book_of_positions_only_still_hits_the_limit() {
        let mut text = String::from("#YANEURAOU-DB2016 1.00\n");
        for ply in 1..=10 {
            text.push_str(&format!(
                "sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - {ply}\n"
            ));
        }
        // 正規化で1局面に畳まれる。局面1つぶんの見積もりが上限 200 を超える
        let err = parse_limited(
            std::io::Cursor::new(text.as_bytes()),
            "/books/a.db",
            200,
            text.len() as u64,
        )
        .expect_err("局面だけでも上限に当たる");

        assert_eq!(err.code(), BookErrorCode::TooLarge);
    }

    /// 1行ぶんの確保はどちらの上限にも入らない。改行を1つも含まないファイルは
    /// 行＝ファイル全体になり、実測で 2 GiB のファイルがピーク 4.32 GB。
    #[test]
    fn a_line_longer_than_the_limit_is_rejected() {
        let text = format!("#YANEURAOU-DB2016 1.00\n{}", "x".repeat(MAX_LINE_BYTES + 1));
        let err = parsed(&text).unwrap_err();

        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert!(err.message().contains("長すぎる"), "{}", err.message());
        // 上限を伝えていること。`0.0MB` のような丸め方だと、どの行も超えるので
        // 文面が何も言っていない
        assert!(err.message().contains("4.1KB"), "{}", err.message());
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    /// 上限ちょうどの行は通す。
    ///
    /// **末尾に改行が無い形で見る。** 改行付きの行だと `take` が切っていないので、
    /// 境界を `>` から `>=` にずらしても落ちない（そう書いて変異が空振りした）。
    #[test]
    fn a_line_at_the_length_limit_is_accepted() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f none 0 0 1\n{}",
            "#".repeat(MAX_LINE_BYTES)
        );
        assert!(parsed(&text).is_ok());
    }

    /// **長すぎる注記は捨てて読み進む。** 本家は注記の中身を見ないので、長い注記を
    /// 1行持つだけの定跡を普通に読む。拒否すると、正しい定跡に対して
    /// 「別のファイルを選び直すこと」という効かない復帰操作を出すことになる。
    ///
    /// 表の不変条件1（本家が読める定跡は、こちらでも読める）の側。
    #[test]
    fn a_note_longer_than_the_line_limit_is_skipped_not_rejected() {
        for marker in ["#", "//"] {
            let text = format!(
                "#YANEURAOU-DB2016 1.00\n{marker}{}\nsfen {HIRATE}\n7g7f none 50 32 1\n",
                "x".repeat(MAX_LINE_BYTES * 3)
            );
            let positions = parsed(&text).expect("長い注記があっても読めるはず");
            assert_eq!(positions.len(), 1, "marker={marker}");
            assert_eq!(positions[&to_book_key(HIRATE).unwrap()].len(), 1);
        }
    }

    /// 展開の見積もりが上限を超えたら落とす。
    #[test]
    fn a_book_that_expands_past_the_limit_is_refused() {
        let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f\n2g2f\n3g3f\n");
        // 局面1 + 指し手3 のちょうど1バイト下
        let err = parse_limited(
            std::io::Cursor::new(text.as_bytes()),
            "/books/a.db",
            BYTES_PER_POSITION + 3 * BYTES_PER_MOVE - 1,
            text.len() as u64,
        )
        .expect_err("上限を超えている");

        assert_eq!(err.code(), BookErrorCode::TooLarge);
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    /// 文面の数字が、そのファイルのどこまで読めたかを指していること。
    ///
    /// **展開の上限そのものを出してはいけない。** ファイルの上限
    /// （[`MAX_FILE_BYTES`]）は展開の上限より小さいので、その2つを並べると
    /// 必ず「小さいファイルが大きい上限を超えた」と読める。利用者はアプリの
    /// 不具合だと判断するか、「上限まで余裕がある」と逆方向へ動く。
    ///
    /// テストも**本番と同じ向き**で組む。上限をファイルより小さくすると、
    /// この性質を構造的に踏めない。
    #[test]
    fn the_limit_message_names_how_far_it_got_not_the_limit() {
        let mut text = String::from("#YANEURAOU-DB2016 1.00\n");
        for rank in 0..9 {
            let run = |n: usize| if n == 0 { String::new() } else { n.to_string() };
            text.push_str(&format!(
                "sfen 4k4/9/9/9/9/9/9/9/{}K{} b - 1\n",
                run(rank),
                run(8 - rank)
            ));
        }

        // 本番と同じ向き: ファイル（20MB）< 展開の上限（6.4GB）
        let err = parse_limited(
            std::io::Cursor::new(text.as_bytes()),
            "/books/a.db",
            280,
            20_000_000,
        )
        .expect_err("上限を超えている");

        let message = err.message();
        assert!(
            message.contains("20.0MB"),
            "ファイルの大きさが無い: {message}"
        );
        // 渡した上限そのものを出していないこと。**実際に渡した値で見る。**
        // 定数（6.4GB）と突き合わせると、上限を小さくしたテストでは何も検出できない。
        assert!(
            !message.contains(&format_size(280)),
            "上限を出している（本番ではファイルより大きいので矛盾して見える）: {message}"
        );
        // 読めた量が出ていること。0 のままだと「どこまで読めたか」を伝えていない
        assert!(!message.contains("0.0KB"), "読めた量が 0 のまま: {message}");
    }

    /// 表の (S1, E0) / (S1, E1) / (S1, E3)。
    ///
    /// 見出しの後、最初の `sfen` 行より前に来る空行・2度目の見出し・`#` 注記。
    /// S0 と S2 では踏んでいたが、S1 だけ通していなかった。
    #[test]
    fn notes_between_the_header_and_the_first_position_are_skipped() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             \n\
             # 生成: 2026-08-30\n\
             #YANEURAOU-DB2016 1.00\n\
             // 出典: floodgate\n\
             sfen {HIRATE}\n\
             7g7f none 50 32 1\n"
        );
        let positions = parsed(&text).expect("注記は読み飛ばされるはず");
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[&to_book_key(HIRATE).unwrap()].len(), 1);
    }

    /// 局面行にも注記にもならない行を通すと、別形式のファイルが
    /// 「0局面の定跡」として開ける。空の定跡と区別が付かず、利用者は全ての局面が
    /// 未収録だと受け取る。
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

    /// 同じブロックの中の重複も畳む。ブロックを跨ぐときだけ畳んでいると、
    /// 手で編集した定跡で同じ指し手が評価値違いに2行並ぶ。
    #[test]
    fn a_move_written_twice_in_the_same_block_is_kept_once() {
        let text = format!(
            "#YANEURAOU-DB2016 1.00\n\
             sfen {HIRATE}\n\
             7g7f none 50 32 100\n\
             7g7f none 40 32 80\n\
             2g2f none 30 32 10\n"
        );
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];

        let usi: Vec<&str> = moves.iter().map(|m| m.usi_move.as_str()).collect();
        assert_eq!(usi, ["7g7f", "2g2f"]);
        assert_eq!(moves[0].value, Some(50), "先に読んだ方が残る");
    }

    /// 走査で畳む形のままだと、同じ局面が延々と繰り返されるファイルで二乗になる
    /// （実測 6.22MB で16秒、100MB なら70分超）。`SCAN_LIMIT` を超える列でも
    /// 畳めていること。
    #[test]
    fn a_position_with_very_many_moves_is_still_deduped() {
        let mut text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n");
        // 相異なる 81 手を2回ずつ書く。`SCAN_LIMIT`（32）を超えるので
        // `HashSet` の枝に入る
        for _ in 0..2 {
            for file in 1..=9 {
                for rank in b'a'..=b'i' {
                    let rank = rank as char;
                    text.push_str(&format!("{file}{rank}1a none 0 0 1\n"));
                }
            }
        }
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];
        assert_eq!(moves.len(), 81, "重複が残っている: {}", moves.len());
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
