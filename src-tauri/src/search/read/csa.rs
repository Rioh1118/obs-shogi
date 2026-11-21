//! CSA を読む。**画面（tsshogi）が開けない形は、読む前に断る。**

use encoding_rs::{Encoding, SHIFT_JIS, UTF_8};
use shogi_kifu_converter_obsshogi::error::ParseError;
use shogi_kifu_converter_obsshogi::parser::parse_csa_str;

use crate::search::read::diagnosis::{parse_failed, unreadable_record};
use crate::search::read::encoding::read_portable_bytes;
use crate::search::read::outcome::{Jkf, KifuReadError};

/// CSA を読む。
///
/// 読むのはクレートの `parse_csa_str`。KIF / KI2 と同じく、読めない行があれば
/// その行を名指しする `ParseError::Csa` を返し、途中までの記録を `Ok` にはしない。
///
/// **クレートが読めても画面が開けない形のうち、見出しの3つの文（手番・`PI`・盤面の段）の
/// 綴りの違いは、ここで断る**（[`viewer_refuses`]）。クレートは CSA の仕様に沿って読み、
/// 画面の `tsshogi` の `importCSA` は行ごとの正規表現で読む。クレートの方が緩い形を
/// 索引に入れると、**検索に出るのに開くと読めない**棋譜ができる。
///
/// それ以外の食い違いは断らない。例えば、駒の動きと合わない指し手（`+7776KI`）は
/// クレートが読み画面が断る。改行が `\r` だけのファイルは、画面が指し手0の棋譜として開く。
pub(crate) fn parse_csa_portable(bytes: &[u8]) -> Result<Jkf, KifuReadError> {
    if let Some(refused) = viewer_refuses(bytes) {
        return Err(parse_failed(unreadable_record(refused)));
    }
    read_portable_bytes(bytes, parse_csa_decoded, parse_csa_str)
}

/// CSA を、クレートと同じ順に復号して読む。
///
/// クレートの `parse_csa_file` を通さず自分で復号するのは、画面の検査
/// （[`viewer_refuses`]）とパースが**同じバイト列を見ていることを型で示す**ため。
/// どちらでも誤りが出るなら [`ParseError::Decode`] を返し、
/// [`read_portable_bytes`] の総当たりへ渡す。
pub(crate) fn parse_csa_decoded(bytes: &[u8]) -> Result<Jkf, ParseError> {
    for enc in CRATE_CSA_DECODE_ORDER {
        let (text, _, had_errors) = enc.decode(bytes);
        if !had_errors {
            return parse_csa_str(&text);
        }
    }
    Err(ParseError::Decode)
}

/// CSA を復号する順。**クレートの `parse_csa_file` の初めの2つに合わせてある。**
///
/// クレートはこの後に EUC-JP も試すが、こちらは [`read_portable_bytes`] の
/// 総当たりが EUC-JP を含めて試すので、ここには置かない。
pub(crate) const CRATE_CSA_DECODE_ORDER: [&Encoding; 2] = [UTF_8, SHIFT_JIS];

/// クレートは読むが、画面（`tsshogi` の `importCSA`）は断る形があれば、
/// その行を名指しするエラーを返す。
///
/// 画面の行パターンは `tests/fixtures/tsshogi_csa_patterns.json` に写してあり、
/// この関数との食い違いは `kifu_reader` のテスト
/// （`the_viewer_check_agrees_with_the_viewers_patterns`）が見る。
///
/// | 文 | 画面のパターン | クレート | ここ |
/// | --- | --- | --- | --- |
/// | 手番 `+` / `-` | `^[-+]$` | 末尾の空白を読み飛ばす | 末尾に空白があれば断る |
/// | `PI…` | `^PI([1-9]{2}[A-Z]{2})*$` | 末尾の空白を読み飛ばす | 末尾に空白があれば断る |
/// | `P1`〜`P9` | `^P[1-9]( \* ?\|[-+][A-Z][A-Z]){9}$` の後に `parseRank` が升を切る | 升9つの後ろの空白を読み飛ばす | パターンに合わないか、切った升が駒名でなければ断る |
///
/// 見る範囲は画面が読む範囲に揃える（[`what_the_viewer_reads`]）。さらに、画面は
/// 手番の文（`+` か `-` ちょうど）を読んだ後の見出しの文を読み飛ばす（`importCSA` の
/// `inMoveSection`）ので、ここもそこで止める。`/` で区切らずに続けた2局目の見出しは見ない。
///
/// 画面は文を `,` で割ってから当てるので、ここも `,` で割る。ただし `'`・`N`・`$` で
/// 始まる行は割らない（`parseLine`）。その行は表のどの文にも当たらないので飛ばす。
///
/// バイト列で見るのは、対象の文が全て ASCII だから。ASCII を1バイトのまま
/// 持つ文字コード（UTF-8・Shift_JIS・EUC-JP）なら、どれで復号しても同じ判定になる。
/// **UTF-16 では成り立たない** —— 文字の間に NUL が挟まり、どの文にも当たらず素通しする。
pub(crate) fn viewer_refuses(bytes: &[u8]) -> Option<ParseError> {
    for (index, line) in what_the_viewer_reads(bytes)
        .split(|b| *b == b'\n')
        .enumerate()
    {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if matches!(line.first(), Some(b'\'' | b'N' | b'$')) {
            continue;
        }
        for statement in line.split(|b| *b == b',') {
            if statement == b"+" || statement == b"-" {
                return None;
            }
            let why = if is_side_or_pi_with_trailing_blank(statement) {
                "the viewer does not read blanks after this statement"
            } else if is_rank(statement)
                && !(cells_the_viewer_reads(&statement[2..], 9) && rank_the_viewer_cuts(statement))
            {
                "the viewer does not read this rank of the board"
            } else {
                continue;
            };
            return Some(ParseError::Csa(format!(
                "at line {}: {why}\n{}",
                index + 1,
                String::from_utf8_lossy(line)
            )));
        }
    }
    None
}

/// 画面が行パターンを当てる範囲。
///
/// 画面は、BOM を外して全体を `trim` した文字列（`src/entities/kifu/api/parse.ts`）を
/// `importCSA` に渡し、`importCSA` は `/` だけの行から後ろ（2局目以降）を捨ててから読む。
/// 範囲の外まで調べると、**画面で開ける棋譜を断る**。
///
/// 頭の空白は落とさない。落とすと、エラーで名指しする行の番号がずれる。
/// 頭の空白は行パターンの当たり方を変えない。
fn what_the_viewer_reads(bytes: &[u8]) -> &[u8] {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let end = bytes
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map_or(0, |last| last + 1);
    let bytes = &bytes[..end];

    // `importCSA` の `/\r?\n\/(\r?\n[\s\S]*)?$/` と同じく、`/` の後ろが
    // 改行か終わりのときだけ区切りと見る
    let separator = bytes.windows(2).enumerate().find_map(|(at, pair)| {
        let rest = &bytes[at + 2..];
        (pair == b"\n/"
            && (rest.is_empty() || rest.starts_with(b"\n") || rest.starts_with(b"\r\n")))
        .then_some(at)
    });
    separator.map_or(bytes, |at| &bytes[..at])
}

fn is_side_or_pi_with_trailing_blank(statement: &[u8]) -> bool {
    let end = statement
        .iter()
        .rposition(|b| !b.is_ascii_whitespace())
        .map_or(0, |last| last + 1);
    let trimmed = &statement[..end];
    trimmed.len() < statement.len()
        && (trimmed == b"+" || trimmed == b"-" || trimmed.starts_with(b"PI"))
}

fn is_rank(statement: &[u8]) -> bool {
    matches!(statement, [b'P', b'1'..=b'9', ..])
}

/// `( \* ?|[-+][A-Z][A-Z]){n}$` に `cells` が合うか。
///
/// 空きの升の後ろの空白は有っても無くてもよいので、正規表現と同じく
/// 両方を試す（空白の詰まった ` * * ` は、空白の無い方で合う）。
fn cells_the_viewer_reads(cells: &[u8], n: usize) -> bool {
    if n == 0 {
        return cells.is_empty();
    }
    match cells {
        [b' ', b'*', tail @ ..] => {
            cells_the_viewer_reads(tail, n - 1)
                || matches!(tail, [b' ', rest @ ..] if cells_the_viewer_reads(rest, n - 1))
        }
        [b'+' | b'-', a, b, tail @ ..] if a.is_ascii_uppercase() && b.is_ascii_uppercase() => {
            cells_the_viewer_reads(tail, n - 1)
        }
        _ => false,
    }
}

/// 画面の駒名。`tsshogi` の `csaNameToPieceType` の鍵。
const VIEWER_PIECE_NAMES: [&[u8]; 14] = [
    b"FU", b"KY", b"KE", b"GI", b"KI", b"KA", b"HI", b"OU", b"TO", b"NY", b"NK", b"NG", b"UM",
    b"RY",
];

/// 行パターンに合った段を、画面の `parseRank` と同じく切って読めるか。
///
/// `parseRank` は升を3文字ずつ切り、次の文字が `*` なら1文字戻る
/// （空きの升の後ろの空白が詰まった ` * * ` を読むため）。この切り方だと
/// 空きの升の直後に空白なしで駒が来る ` *-KA` を ` *-`・`KA ` と切ってしまい、
/// 行パターンには合うのに開けない。
fn rank_the_viewer_cuts(statement: &[u8]) -> bool {
    let mut begin = 2;
    for _ in 0..9 {
        let section = statement
            .get(begin..(begin + 3).min(statement.len()))
            .unwrap_or_default();
        begin += 3;
        if statement.get(begin) == Some(&b'*') {
            begin -= 1;
        }
        match section {
            [b' ', ..] => {}
            [_, name @ ..] if VIEWER_PIECE_NAMES.contains(&name) => {}
            _ => return false,
        }
    }
    true
}
