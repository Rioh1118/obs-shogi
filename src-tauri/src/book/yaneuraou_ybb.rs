//! やねうら王バイナリ定跡（`.ybb`）を、丸読みせずに引く。
//!
//! 形式の出典はやねうら王の公開ソース（`yaneurao/YaneuraOu`、GPL-3.0）。読んで書いたもので、
//! コードは写していない。
//!
//! - 定跡の形: `source/book/book.cpp` の YbbMagic、read_ybb_header、read_ybb_index_entry、
//!   read_ybb_moves、find_ybb_bookmoves_on_the_fly（やねうら王の関数名。このリポジトリには無い）
//! - 局面の詰め方: `source/extra/sfen_packer.cpp` の `SfenPacker::pack`（なのは mini 由来の
//!   ハフマン符号。cshogi と同じ並び）
//! - 升・駒・指し手の番号: `source/types.h` の `Square` / `PieceType` / `Move16`
//!
//! ファイルの並び（数は全てリトルエンディアン）:
//!
//! ```text
//! 頭     32 バイト   "YANE-BINBOOK-V1\0"、局面の数 u64、フラグ u64（1 = 指し手に深さが付く）
//! 索引   44 バイト × 局面の数   詰めた局面 32 バイト、指し手の位置 u64、手数 u16、指し手の数 u16
//!                                （詰めた局面のバイト列の昇順）
//! 指し手 4 か 6 バイト × 指し手の数   指し手 u16、評価値 i16、（フラグがあれば）深さ u16
//! ```
//!
//! **開くときに読むのは頭の 32 バイトだけ。** 配布物は 1.5 GB あり、引くたびに索引を二分探索して
//! 1局面の指し手だけを読む（エンジンの on-the-fly と同じ引き方）。

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::book::error::{BookError, BookErrorCode};
use crate::book::reader::BookReader;
use crate::book::sfen::key::BookKey;
use crate::book::types::BookMove;

const MAGIC: &[u8; 16] = b"YANE-BINBOOK-V1\0";
const HEADER_BYTES: u64 = 32;
const INDEX_RECORD_BYTES: u64 = 44;
/// 指し手に深さ（u16）が付く
const FLAG_MOVE_DEPTH: u64 = 1;
const KNOWN_FLAGS: u64 = FLAG_MOVE_DEPTH;

/// 開いた `.ybb`。ファイルは開いたまま持ち、引くたびに位置を動かして読む
pub(crate) struct YaneuraouYbbReader {
    path: PathBuf,
    /// 位置を動かして読むので、引く人を1人ずつにする
    file: Mutex<File>,
    record_count: u64,
    flags: u64,
}

impl YaneuraouYbbReader {
    pub(crate) fn position_count(&self) -> u64 {
        self.record_count
    }

    fn broken(&self, what: &str) -> BookError {
        broken(&self.path, what)
    }

    fn move_record_bytes(&self) -> u64 {
        if self.flags & FLAG_MOVE_DEPTH != 0 {
            6
        } else {
            4
        }
    }
}

fn broken(path: &Path, what: &str) -> BookError {
    BookError::new(
        BookErrorCode::InvalidContent,
        format!("やねうら王バイナリ定跡として読めない（{what}）。取得し直すか、別の定跡を開くこと"),
    )
    .with_path(path.to_string_lossy())
}

fn io_error(path: &Path) -> impl Fn(std::io::Error) -> BookError + '_ {
    move |e| BookError::from_io(e, path.to_string_lossy())
}

/// 頭を読んで開く。索引と指し手は読まない。`size` は `metadata` の大きさ
pub(crate) fn open(path: &Path, size: u64) -> Result<YaneuraouYbbReader, BookError> {
    let mut file = File::open(path).map_err(io_error(path))?;
    if size < HEADER_BYTES {
        return Err(broken(path, "頭が足りない"));
    }
    let mut head = [0u8; HEADER_BYTES as usize];
    file.read_exact(&mut head).map_err(io_error(path))?;
    if &head[..16] != MAGIC {
        return Err(broken(path, "先頭の印が違う"));
    }
    let record_count = u64::from_le_bytes(head[16..24].try_into().expect("8 バイト"));
    let flags = u64::from_le_bytes(head[24..32].try_into().expect("8 バイト"));
    if flags & !KNOWN_FLAGS != 0 {
        return Err(broken(path, "知らないフラグがある"));
    }
    // 索引がファイルに収まらなければ、二分探索が範囲の外を読みに行く
    let index_end = record_count
        .checked_mul(INDEX_RECORD_BYTES)
        .and_then(|n| n.checked_add(HEADER_BYTES));
    if index_end.is_none_or(|end| end > size) {
        return Err(broken(path, "索引がファイルに収まらない"));
    }
    Ok(YaneuraouYbbReader {
        path: path.to_path_buf(),
        file: Mutex::new(file),
        record_count,
        flags,
    })
}

/// 索引の1件のうち、引くのに要る欄
struct IndexEntry {
    packed: [u8; 32],
    moves_offset: u64,
    move_count: u16,
}

impl YaneuraouYbbReader {
    fn read_exact_at(&self, file: &mut File, at: u64, buf: &mut [u8]) -> Result<(), BookError> {
        file.seek(SeekFrom::Start(at))
            .map_err(io_error(&self.path))?;
        file.read_exact(buf).map_err(|e| {
            if e.kind() == std::io::ErrorKind::UnexpectedEof {
                self.broken("途中で切れている")
            } else {
                BookError::from_io(e, self.path.to_string_lossy())
            }
        })
    }

    fn index_entry(&self, file: &mut File, i: u64) -> Result<IndexEntry, BookError> {
        let mut rec = [0u8; INDEX_RECORD_BYTES as usize];
        self.read_exact_at(file, HEADER_BYTES + i * INDEX_RECORD_BYTES, &mut rec)?;
        Ok(IndexEntry {
            packed: rec[..32].try_into().expect("32 バイト"),
            moves_offset: u64::from_le_bytes(rec[32..40].try_into().expect("8 バイト")),
            move_count: u16::from_le_bytes(rec[42..44].try_into().expect("2 バイト")),
        })
    }

    fn moves_of(&self, file: &mut File, entry: &IndexEntry) -> Result<Vec<BookMove>, BookError> {
        let width = self.move_record_bytes();
        let start = (HEADER_BYTES + self.record_count * INDEX_RECORD_BYTES)
            .checked_add(entry.moves_offset)
            .ok_or_else(|| self.broken("指し手の位置が大きすぎる"))?;
        let mut bytes = vec![0u8; (u64::from(entry.move_count) * width) as usize];
        self.read_exact_at(file, start, &mut bytes)?;
        bytes
            .chunks_exact(width as usize)
            .map(|rec| {
                let raw = u16::from_le_bytes([rec[0], rec[1]]);
                let usi_move =
                    usi_of_move16(raw).ok_or_else(|| self.broken("読めない指し手がある"))?;
                let value = i16::from_le_bytes([rec[2], rec[3]]);
                let depth = (width == 6).then(|| i32::from(u16::from_le_bytes([rec[4], rec[5]])));
                Ok(BookMove {
                    usi_move,
                    ponder: None,
                    value: Some(i32::from(value)),
                    depth,
                    count: None,
                })
            })
            .collect()
    }
}

impl BookReader for YaneuraouYbbReader {
    /// 手数は見ない。鍵が手数を持たない（同じ局面を手数違いで別にしない）ので、エンジンの
    /// `IgnoreBookPly` を有効にしたときと同じ引き方になる
    fn lookup(&self, key: &BookKey) -> Result<Vec<BookMove>, BookError> {
        let Some(target) = pack(key.as_str()) else {
            return Ok(vec![]);
        };
        let mut file = self
            .file
            .lock()
            .map_err(|_| self.broken("前の読み取りが途中で失敗した"))?;
        let (mut left, mut right) = (0u64, self.record_count);
        while left < right {
            let middle = left + (right - left) / 2;
            let entry = self.index_entry(&mut file, middle)?;
            match target.cmp(&entry.packed) {
                std::cmp::Ordering::Less => right = middle,
                std::cmp::Ordering::Greater => left = middle + 1,
                std::cmp::Ordering::Equal => return self.moves_of(&mut file, &entry),
            }
        }
        Ok(vec![])
    }
}

/// やねうら王の升の番号（1一 = 0、1二 = 1 … 9九 = 80）を USI の綴りにする
fn usi_square(sq: u16) -> Option<String> {
    (sq < 81).then(|| {
        let file = sq / 9 + 1;
        let rank = sq % 9;
        format!("{file}{}", char::from(b'a' + rank as u8))
    })
}

/// `Move16` を USI の綴りにする。下位 7 ビットが行き先、次の 7 ビットが元の升（打つ手は駒の種類）、
/// 1<<14 が打つ手、1<<15 が成り
fn usi_of_move16(raw: u16) -> Option<String> {
    let to = usi_square(raw & 0x7f)?;
    let from = (raw >> 7) & 0x7f;
    if raw & (1 << 14) != 0 {
        // 駒の種類の番号は 歩1 香2 桂3 銀4 角5 飛6 金7
        let piece = match from {
            1 => 'P',
            2 => 'L',
            3 => 'N',
            4 => 'S',
            5 => 'B',
            6 => 'R',
            7 => 'G',
            _ => return None,
        };
        return Some(format!("{piece}*{to}"));
    }
    let from = usi_square(from)?;
    let promote = if raw & (1 << 15) != 0 { "+" } else { "" };
    Some(format!("{from}{to}{promote}"))
}

/// 下位のビットから詰めていく 256 ビットの入れ物
struct Bits {
    data: [u8; 32],
    cursor: usize,
}

impl Bits {
    fn push(&mut self, value: u32, n: usize) -> Option<()> {
        for i in 0..n {
            if self.cursor >= 256 {
                return None;
            }
            if value & (1 << i) != 0 {
                self.data[self.cursor / 8] |= 1 << (self.cursor % 8);
            }
            self.cursor += 1;
        }
        Some(())
    }
}

/// 駒の種類の番号（`PieceType`）。歩1 香2 桂3 銀4 角5 飛6 金7
fn kind_of(letter: char) -> Option<usize> {
    Some(match letter.to_ascii_uppercase() {
        'P' => 1,
        'L' => 2,
        'N' => 3,
        'S' => 4,
        'B' => 5,
        'R' => 6,
        'G' => 7,
        _ => return None,
    })
}

/// 盤上の符号（成りと先後の前）と、そのビット数。添字は `kind_of`。0 は空の升
const BOARD_CODE: [(u32, usize); 8] = [
    (0x00, 1),
    (0x01, 2),
    (0x03, 4),
    (0x0b, 4),
    (0x07, 4),
    (0x1f, 6),
    (0x3f, 6),
    (0x0f, 5),
];
/// 駒箱（盤にも持駒にも無い駒）の符号
const BOX_CODE: [(u32, usize); 8] = [
    (0x00, 1),
    (0x02, 2),
    (0x09, 4),
    (0x0d, 4),
    (0x0b, 4),
    (0x2f, 6),
    (0x3f, 6),
    (0x1b, 5),
];
/// 駒の種類ごとの全部の枚数
const FULL_SET: [u32; 8] = [0, 18, 4, 4, 4, 2, 2, 4];
/// 持駒と駒箱を書く順（歩 香 桂 銀 金 角 飛）
const HAND_ORDER: [usize; 7] = [1, 2, 3, 4, 7, 5, 6];
const GOLD: usize = 7;

/// 正規化した鍵（`盤 手番 持駒`）を、やねうら王の詰めた局面（32 バイト）にする。
/// 詰められない局面（駒が多すぎる、など）は `None` で、どの索引とも一致しない
fn pack(key: &str) -> Option<[u8; 32]> {
    let mut parts = key.split(' ');
    let (board, side, hands) = (parts.next()?, parts.next()?, parts.next()?);

    // 升の番号は (筋 - 1) * 9 + (段 - 1)。SFEN は 1段目の 9筋から左へ書く
    // 玉の升は盤の並びに書かない（位置は先頭の 7 ビット × 2 が持つ）
    #[derive(Clone, Copy)]
    enum On {
        Empty,
        King,
        Piece(usize, bool, bool),
    }
    let mut squares = [On::Empty; 81];
    let mut kings: [u32; 2] = [81, 81];
    for (r, row) in board.split('/').enumerate() {
        let mut file = 9usize;
        let mut promoted = false;
        for c in row.chars() {
            if let Some(n) = c.to_digit(10) {
                file = file.checked_sub(n as usize)?;
                continue;
            }
            if c == '+' {
                promoted = true;
                continue;
            }
            let sq = (file.checked_sub(1)?) * 9 + r;
            let white = c.is_ascii_lowercase();
            if c.eq_ignore_ascii_case(&'k') {
                kings[usize::from(white)] = sq as u32;
                squares[sq] = On::King;
            } else {
                squares[sq] = On::Piece(kind_of(c)?, promoted, white);
            }
            promoted = false;
            file -= 1;
        }
    }

    let mut bits = Bits {
        data: [0; 32],
        cursor: 0,
    };
    bits.push(u32::from(side == "w"), 1)?;
    bits.push(kings[0], 7)?;
    bits.push(kings[1], 7)?;

    let mut left = FULL_SET;
    for square in squares {
        let (kind, promoted, white) = match square {
            On::King => continue,
            On::Empty => {
                bits.push(BOARD_CODE[0].0, BOARD_CODE[0].1)?;
                continue;
            }
            On::Piece(kind, promoted, white) => (kind, promoted, white),
        };
        let (code, n) = BOARD_CODE[kind];
        bits.push(code, n)?;
        if kind != GOLD {
            bits.push(u32::from(promoted), 1)?;
        }
        bits.push(u32::from(white), 1)?;
        left[kind] = left[kind].checked_sub(1)?;
    }

    let mut held = [[0u32; 8]; 2];
    if hands != "-" {
        let mut count = 0u32;
        for c in hands.chars() {
            if let Some(d) = c.to_digit(10) {
                count = count * 10 + d;
                continue;
            }
            held[usize::from(c.is_ascii_lowercase())][kind_of(c)?] += count.max(1);
            count = 0;
        }
    }
    for (color, held) in held.iter().enumerate() {
        for kind in HAND_ORDER {
            let (code, n) = BOARD_CODE[kind];
            for _ in 0..held[kind] {
                bits.push(code >> 1, n - 1)?;
                if kind != GOLD {
                    bits.push(0, 1)?;
                }
                bits.push(color as u32, 1)?;
            }
            left[kind] = left[kind].checked_sub(held[kind])?;
        }
    }
    for kind in HAND_ORDER {
        let (code, n) = BOX_CODE[kind];
        for _ in 0..left[kind] {
            bits.push(code, n)?;
            if kind != GOLD {
                bits.push(0, 1)?;
            }
        }
    }
    Some(bits.data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::sfen::key::to_book_key;
    use test_support::dir::temp_dir;

    const HIRATE: &str = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
    /// 平手の初期局面を詰めたもの。手元の配布物の `.ybb`（1.5 GB）の索引から、この局面を
    /// 二分探索で引き当てた 32 バイト（2026-11-21）。自前の詰め方だけで期待値を作ると、
    /// 詰め方の誤りがそのまま期待値になる
    const HIRATE_PACKED: &str = "58a451220ceb67227e9653221caf447824c22b119e53221ceb6f223e9651220c";
    /// 7g7f 3c3d 8h2b+ の後（盤に成った角、先手の持駒に角）。同じ配布物で引き当てたもの
    const EXCHANGED: &str = "lnsgkgsnl/1r5+B1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/7R1/LNSGKGSNL w B 4";
    const EXCHANGED_PACKED: &str =
        "59a451220ceb57227e9693241caf447824c22b119e53121ceb6f222ca344181e";

    fn packed(sfen: &str) -> [u8; 32] {
        pack(to_book_key(sfen).expect("鍵").as_str()).expect("詰められる")
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn the_initial_position_packs_like_the_engine() {
        assert_eq!(hex(&packed(HIRATE)), HIRATE_PACKED);
    }

    #[test]
    fn promoted_pieces_and_pieces_in_hand_pack_like_the_engine() {
        assert_eq!(hex(&packed(EXCHANGED)), EXCHANGED_PACKED);
    }

    /// 頭・索引（詰めた局面の昇順）・指し手を並べた `.ybb` を作る。`depth` でフラグを決める
    /// 指し手、評価値、深さ
    type Moves<'a> = &'a [(u16, i16, u16)];

    fn ybb(entries: &[(&str, Moves)], depth: bool) -> Vec<u8> {
        let mut entries: Vec<([u8; 32], Moves)> = entries
            .iter()
            .map(|(sfen, moves)| (packed(sfen), *moves))
            .collect();
        entries.sort_by_key(|e| e.0);
        let mut out = MAGIC.to_vec();
        out.extend_from_slice(&(entries.len() as u64).to_le_bytes());
        out.extend_from_slice(&u64::from(depth).to_le_bytes());
        let mut body = Vec::new();
        for (packed, moves) in &entries {
            out.extend_from_slice(packed);
            out.extend_from_slice(&(body.len() as u64).to_le_bytes());
            out.extend_from_slice(&1u16.to_le_bytes());
            out.extend_from_slice(&(moves.len() as u16).to_le_bytes());
            for (m, v, d) in moves.iter() {
                body.extend_from_slice(&m.to_le_bytes());
                body.extend_from_slice(&v.to_le_bytes());
                if depth {
                    body.extend_from_slice(&d.to_le_bytes());
                }
            }
        }
        out.extend_from_slice(&body);
        out
    }

    fn opened(name: &str, bytes: &[u8]) -> (PathBuf, Result<YaneuraouYbbReader, BookError>) {
        let dir = temp_dir(name);
        let path = dir.join("book.ybb");
        std::fs::write(&path, bytes).expect("書けない");
        let size = bytes.len() as u64;
        (dir, open(&path, size))
    }

    fn lookup(reader: &YaneuraouYbbReader, sfen: &str) -> Vec<(String, Option<i32>, Option<i32>)> {
        reader
            .lookup(&to_book_key(sfen).expect("鍵"))
            .expect("引ける")
            .into_iter()
            .map(|m| (m.usi_move, m.value, m.depth))
            .collect()
    }

    /// 7g7f（盤上）、8h2b+（成り）、B*5e（打つ）を `Move16` で書く
    const M_7G7F: u16 = 59 | (60 << 7);
    const M_8H2B_PROMOTE: u16 = 10 | (70 << 7) | (1 << 15);
    const M_DROP_B_5E: u16 = 40 | (5 << 7) | (1 << 14);

    #[test]
    fn the_moves_of_a_position_are_found_by_binary_search() {
        let after_7g7f = "lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2";
        let bytes = ybb(
            &[
                (HIRATE, &[(M_7G7F, 53, 40)]),
                (EXCHANGED, &[(M_DROP_B_5E, -20, 12)]),
                (after_7g7f, &[(M_8H2B_PROMOTE, -5, 3)]),
            ],
            true,
        );
        let (dir, reader) = opened("ybb-found", &bytes);
        let reader = reader.expect("開ける");

        assert_eq!(reader.position_count(), 3);
        // 手数は見ない（鍵が手数を持たない）
        assert_eq!(
            lookup(
                &reader,
                "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 99"
            ),
            [("7g7f".to_string(), Some(53), Some(40))]
        );
        assert_eq!(
            lookup(&reader, after_7g7f),
            [("8h2b+".to_string(), Some(-5), Some(3))]
        );
        assert_eq!(
            lookup(&reader, EXCHANGED),
            [("B*5e".to_string(), Some(-20), Some(12))]
        );
        // 載っていない局面は空（エラーではない）
        assert!(lookup(&reader, "4k4/9/9/9/9/9/9/9/4K4 b - 1").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// フラグが無ければ指し手は 4 バイトで、深さは無い
    #[test]
    fn without_the_depth_flag_moves_have_no_depth() {
        let bytes = ybb(&[(HIRATE, &[(M_7G7F, 7, 0), (M_DROP_B_5E, -7, 0)])], false);
        let (dir, reader) = opened("ybb-no-depth", &bytes);
        assert_eq!(
            lookup(&reader.expect("開ける"), HIRATE),
            [
                ("7g7f".to_string(), Some(7), None),
                ("B*5e".to_string(), Some(-7), None)
            ]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 壊れたファイルは開くとき、または引くときに `InvalidContent`。panic しない
    #[test]
    fn a_broken_file_is_reported_as_broken_content() {
        let good = ybb(&[(HIRATE, &[(M_7G7F, 1, 1)])], true);
        let mut bad_magic = good.clone();
        bad_magic[0] = b'X';
        let mut unknown_flag = good.clone();
        unknown_flag[24] = 2;
        let mut too_many = good.clone();
        too_many[16..24].copy_from_slice(&1000u64.to_le_bytes());
        for (name, bytes) in [
            ("short", good[..10].to_vec()),
            ("magic", bad_magic),
            ("flag", unknown_flag),
            ("index", too_many),
        ] {
            let (dir, reader) = opened(&format!("ybb-broken-{name}"), &bytes);
            let Err(err) = reader else {
                panic!("{name}: 開けてしまった");
            };
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "{name}");
            let _ = std::fs::remove_dir_all(&dir);
        }

        // 指し手が途中で切れている・読めない升を指している
        // 行き先 127 は盤の外
        let bad_square = ybb(&[(HIRATE, &[(127, 1, 1)])], true);
        for (name, bytes) in [
            ("cut", good[..good.len() - 2].to_vec()),
            ("square", bad_square),
        ] {
            let (dir, reader) = opened(&format!("ybb-broken-moves-{name}"), &bytes);
            let err = reader
                .expect("頭は読める")
                .lookup(&to_book_key(HIRATE).expect("鍵"))
                .expect_err("壊れている");
            assert_eq!(err.code(), BookErrorCode::InvalidContent, "{name}");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
}
