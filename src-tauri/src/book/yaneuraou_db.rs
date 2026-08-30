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
//! 大きいファイルの上限・進捗・中断は #197。ここでは扱わない。

use crate::book::error::{BookError, BookErrorCode};
use crate::book::sfen::{to_book_key_in_file, BookKey};
use crate::book::types::BookMove;
use std::collections::HashMap;
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
pub(crate) fn load(path: &Path) -> Result<YaneuraouDbReader, BookError> {
    let shown = path.to_string_lossy();
    let bytes = std::fs::read(path).map_err(|e| BookError::from_io(e, shown.clone()))?;

    // BOM 付きで配られている定跡がある。落とさないとヘッダの検査が必ず外れる。
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);

    // 壊れたバイト列を lossy で読むと、置換文字を含むキーが黙って登録される。
    // そのキーは引かれることが無いので、「定跡に載っていない」と区別が付かない。
    let text = std::str::from_utf8(bytes).map_err(|_| {
        invalid_content(
            "定跡ファイルが UTF-8 として読めない。取得し直すか、別の定跡を開くこと",
            &shown,
        )
    })?;

    let positions = parse(text, &shown)?;
    Ok(YaneuraouDbReader { positions })
}

fn invalid_content(message: &str, path: &str) -> BookError {
    BookError::new(BookErrorCode::InvalidContent, message).with_path(path)
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

/// 本文を局面ごとに畳む。
///
/// ヘッダを検査するのは、別形式のファイルに `.db` を付けただけのものを
/// 「0局面の定跡」として開かないため。空の定跡と見分けが付かなくなる。
fn parse(text: &str, path: &str) -> Result<HashMap<BookKey, Vec<BookMove>>, BookError> {
    let mut lines = text.lines().map(str::trim_end).enumerate();

    let header = lines
        .by_ref()
        .find(|(_, line)| !line.trim().is_empty())
        .map(|(_, line)| line);

    match header {
        Some(line) if line.starts_with(HEADER_PREFIX) => {}
        Some(line) => {
            return Err(invalid_content(
                &format!(
                    "やねうら王テキスト定跡の見出しが無い（1行目: {}）。\
                     別の形式のファイルかもしれない。取得し直すか、別の定跡を開くこと",
                    crate::book::error::truncate_path(line)
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

    for (index, line) in lines {
        let line = line.trim();
        if is_skippable(line) {
            continue;
        }

        if let Some(rest) = line.strip_prefix("sfen ") {
            current = Some(to_book_key_in_file(rest, path)?);
            // 同じ局面が2度書かれていても、後から来た手を捨てない。
            positions
                .entry(current.clone().expect("直前に入れた"))
                .or_default();
            continue;
        }

        let Some(key) = current.clone() else {
            return Err(invalid_content(
                &format!(
                    "局面より先に指し手が書かれている（{}行目）。\
                     途中で切れたファイルかもしれない。取得し直すか、別の定跡を開くこと",
                    index + 1
                ),
                path,
            ));
        };

        positions
            .entry(key)
            .or_default()
            .push(parse_move(line, index + 1, path)?);
    }

    Ok(positions)
}

/// 指し手の行を1つ読む。
///
/// 並びは `指し手 応手 評価値 深さ 選択回数`。後ろの3つは形式として optional で、
/// 同じファイルの中でも行によって欠ける。空文字が置かれていることもある。
///
/// **指し手そのものは検証しない。** USI の綴りを判定する実装をここに持つと、
/// 定跡側が使う綴り（`resign` など）を知らずに弾いてしまい、読めるはずの定跡が
/// 開けなくなる。壊れたファイルは見出しの検査で落とす。
fn parse_move(line: &str, line_number: usize, path: &str) -> Result<BookMove, BookError> {
    let mut tokens = line.split_whitespace();

    let usi_move = tokens
        .next()
        .ok_or_else(|| {
            invalid_content(
                &format!(
                    "指し手の無い行がある（{line_number}行目）。取得し直すか、別の定跡を開くこと"
                ),
                path,
            )
        })?
        .to_string();

    let ponder = match tokens.next() {
        // 応手が無いことを示す綴り。文字列 "none" のまま返すと、フロントは
        // それを指し手として扱える形で受け取ってしまう。
        None | Some("none") | Some("") => None,
        Some(value) => Some(value.to_string()),
    };

    Ok(BookMove {
        usi_move,
        ponder,
        value: optional_number(tokens.next()),
        depth: optional_number(tokens.next()),
        count: optional_number(tokens.next()),
    })
}

/// 数値として読めない綴りは、行ごと落とさずに欠損として扱う。
///
/// 評価値や深さは付加情報で、無くても候補手としては使える。1つの綴りのために
/// その局面の定跡を丸ごと失う方が損。
fn optional_number<T: std::str::FromStr>(token: Option<&str>) -> Option<T> {
    token.and_then(|t| t.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::reader::BookReader;
    use crate::book::sfen::to_book_key;

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

    fn loaded(text: &str) -> HashMap<BookKey, Vec<BookMove>> {
        parse(text, "/books/a.db").expect("読めるはず")
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
        assert!(parse(&text, "/books/a.db").is_ok());
    }

    /// 見出しを検査しないと、別形式のファイルが「0局面の定跡」として開ける。
    /// 空の定跡と区別が付かず、利用者は全ての局面が未収録だと受け取る。
    #[test]
    fn rejects_a_file_that_is_not_a_yaneuraou_book() {
        let err = parse("これは定跡ではない\n7g7f\n", "/books/a.db").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
        assert_eq!(err.path(), Some("/books/a.db"));
        assert!(err.message().contains("こと"), "{}", err.message());
    }

    #[test]
    fn rejects_an_empty_file() {
        let err = parse("", "/books/a.db").unwrap_err();
        assert_eq!(err.code(), BookErrorCode::InvalidContent);
    }

    /// 途中で切れたファイルは、局面より先に指し手が来る形になる。
    #[test]
    fn rejects_moves_before_any_position() {
        let err = parse("#YANEURAOU-DB2016 1.00\n7g7f 3c3d 50 32 1\n", "/books/a.db").unwrap_err();
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
        let err = parse(text, "/books/a.db").unwrap_err();

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

    /// 局面が2度書かれていても、後から来た手を捨てない。
    #[test]
    fn merges_a_position_that_appears_twice() {
        let text = format!("#YANEURAOU-DB2016 1.00\nsfen {HIRATE}\n7g7f\nsfen {HIRATE}\n2g2f\n");
        let moves = &loaded(&text)[&to_book_key(HIRATE).unwrap()];
        assert_eq!(moves.len(), 2);
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

        let result = load(&file);
        std::fs::remove_dir_all(&dir).expect("テスト用のディレクトリを消せない");

        let reader = result.expect("BOM 付きでも読めるはず");
        assert_eq!(reader.position_count(), 2);
    }
}
