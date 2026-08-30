use std::{
    fs,
    path::{Path, PathBuf},
};

use thiserror::Error;

use crate::search::fs_scan::{FileRecord, KifuKind};

pub type ReadOk = Vec<(FileRecord, Jkf)>;
pub type ReadErr = Vec<(FileRecord, KifuReadError)>;

// shogi-kifu-converter
use shogi_kifu_converter_obsshogi::parser::{
    parse_csa_file, parse_jkf_file, parse_ki2_file, parse_ki2_str, parse_kif_file, parse_kif_str,
};

use encoding_rs::{EUC_JP, ISO_2022_JP, UTF_16BE, UTF_16LE};

pub type Jkf = shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;

#[derive(Debug, Error)]
pub enum KifuReadError {
    #[error("unsupported kifu kind: {0:?}")]
    UnsupportedKind(KifuKind),

    #[error("parse failed: {path}: {message}")]
    ParseFailed { path: PathBuf, message: String },
}

pub fn read_to_jkf(rec: &FileRecord) -> Result<Jkf, KifuReadError> {
    read_path_to_jkf(&rec.path, rec.kind)
}

pub fn read_path_to_jkf(path: &Path, kind: KifuKind) -> Result<Jkf, KifuReadError> {
    match kind {
        KifuKind::Kif => parse_kif_portable(path),
        KifuKind::Ki2 => parse_ki2_portable(path),
        KifuKind::Csa => parse_csa_file(path).map_err(|e| failed(path, e)),
        KifuKind::Jkf => parse_jkf_file(path).map_err(|e| failed(path, e)),
    }
}

fn failed(path: &Path, e: impl std::fmt::Display) -> KifuReadError {
    KifuReadError::ParseFailed {
        path: path.to_path_buf(),
        message: e.to_string(),
    }
}

/// 走査結果(FileRecord)をまとめて JKF に読み取る
pub fn read_many_to_jkf(records: &[FileRecord]) -> (ReadOk, ReadErr) {
    let mut ok = Vec::new();
    let mut ng = Vec::new();

    for r in records {
        match read_to_jkf(r) {
            Ok(jkf) => ok.push((r.clone(), jkf)),
            Err(e) => ng.push((r.clone(), e)),
        }
    }

    (ok, ng)
}

// -------------------------
// Portable parsers (KIF/KI2)
// -------------------------

fn parse_kif_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    let reason = match parse_kif_file(path) {
        Ok(jkf) => return Ok(jkf),
        Err(e) => e,
    };

    let bytes = read_bytes(path)?;
    try_other_encodings(&bytes, parse_kif_str).ok_or_else(|| failed(path, reason))
}

fn parse_ki2_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    let reason = match parse_ki2_file(path) {
        Ok(jkf) => return Ok(jkf),
        Err(e) => e,
    };

    let bytes = read_bytes(path)?;
    try_other_encodings(&bytes, parse_ki2_str).ok_or_else(|| failed(path, reason))
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, KifuReadError> {
    fs::read(path).map_err(|e| KifuReadError::ParseFailed {
        path: path.to_path_buf(),
        message: format!("io error: {e}"),
    })
}

/// クレートが見ない文字コードで decode → parse を試す。読めたら `Some`。
///
/// クレートは拡張子が名乗る文字コードと Shift_JIS / UTF-8 のもう一方しか試さない
/// （`parser::read_kifu`）。実測でこの4つが残る。
///
/// | 文字コード | クレート単体 |
/// | --- | --- |
/// | EUC-JP | `Decode Error` |
/// | UTF-16LE / UTF-16BE | `Decode Error` |
/// | ISO-2022-JP | Shift_JIS として解釈が通ってしまい、指し手行で落ちる |
///
/// **読めなかったときに理由を返さないのは意図的。** クレートが返した理由のほうが
/// 具体的（「何行目の何が読めないか」を言う）で、ここで試した分の失敗を並べると
/// それが埋まる。呼び手はクレート側の理由を使う。
fn try_other_encodings<F>(bytes: &[u8], mut parse: F) -> Option<Jkf>
where
    F: FnMut(&str) -> Result<Jkf, shogi_kifu_converter_obsshogi::error::ParseError>,
{
    for enc in [UTF_16LE, UTF_16BE, EUC_JP, ISO_2022_JP] {
        let (cow, _, _) = enc.decode(bytes);
        if let Ok(jkf) = parse(cow.as_ref()) {
            return Some(jkf);
        }
    }

    // 最終手段。読めない位置を落として読み進める。#293 で扱いを決めるまでは、
    // 「開けない」より「一部が欠けても開ける」を採る既存の判断を変えない
    parse(&String::from_utf8_lossy(bytes)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::SHIFT_JIS;

    const HIRATE: &str = "手合割：平手\n\
                          手数----指手---------消費時間--\n   \
                          1 ７六歩(77)   ( 0:01/00:00:01)\n";

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "obs-shogi-{tag}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::create_dir_all(&dir).expect("一時ディレクトリ");
        dir
    }

    /// 拡張子が名乗る文字コードと中身が食い違うファイルを読む。
    ///
    /// クレートは拡張子の文字コードと Shift_JIS / UTF-8 のもう一方しか試さない。
    /// ここに挙げた4つは**クレート単体では読めない**ことを実測で確かめてある
    /// （EUC-JP / UTF-16 は `Decode Error`、ISO-2022-JP は指し手行で落ちる）。
    /// `try_other_encodings` はそのために残してある。
    #[test]
    fn encodings_the_crate_does_not_try_are_still_read() {
        let dir = temp_dir("encoding");

        for (label, enc) in [
            ("eucjp", EUC_JP),
            ("iso2022", ISO_2022_JP),
            ("utf16le", UTF_16LE),
            ("utf16be", UTF_16BE),
        ] {
            let bytes: Vec<u8> = if enc == UTF_16LE || enc == UTF_16BE {
                // encoding_rs は UTF-16 へ encode できないので自分で組む
                HIRATE
                    .encode_utf16()
                    .flat_map(|u| {
                        if enc == UTF_16LE {
                            u.to_le_bytes()
                        } else {
                            u.to_be_bytes()
                        }
                    })
                    .collect()
            } else {
                let (cow, _, had_errors) = enc.encode(HIRATE);
                assert!(!had_errors, "{label} へ encode できること");
                cow.into_owned()
            };

            let path = dir.join(format!("{label}.kif"));
            fs::write(&path, &bytes).expect("書き出し");

            let jkf = read_path_to_jkf(&path, KifuKind::Kif)
                .unwrap_or_else(|e| panic!("{label} が読めない: {e}"));
            assert_eq!(jkf.moves.len(), 2, "{label} の指し手数");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// クレートが読めた上で拒んだのなら、その理由をそのまま返す。
    ///
    /// 文字コードの総当たりは、当たらなかったぶんの失敗を積むと**クレートが言った
    /// 具体的な理由を埋めてしまう**。v0.4.0 のパーサは読み残しがある入力を
    /// エラーにするようになったので、この経路を通る棋譜が実際に出てくる。
    #[test]
    fn a_readable_file_the_parser_rejects_keeps_the_crates_reason() {
        let dir = temp_dir("reason");
        let path = dir.join("unknown-word.kif");
        // 「パス」は KIF の語彙に無い。文字コードは Shift_JIS で正しい
        let text = format!("{HIRATE}   2 パス\n");
        let (bytes, _, _) = SHIFT_JIS.encode(&text);
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("パス"),
            "読めなかった語を指していない: {message}"
        );
        assert!(
            !message.contains("utf-16"),
            "総当たりの失敗が理由を埋めている: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 手合割の名前だけを変えた同じ棋譜。上手（後手）から指すので ３四歩 は
    /// どの手合割でも指せる（3三の歩はどの手合割でも落ちない）
    const HANDICAPS: [&str; 15] = [
        "香落ち",
        "右香落ち",
        "角落ち",
        "飛車落ち",
        "飛香落ち",
        "二枚落ち",
        "三枚落ち",
        "四枚落ち",
        "五枚落ち",
        "左五枚落ち",
        "六枚落ち",
        "右七枚落ち",
        "左七枚落ち",
        "八枚落ち",
        "十枚落ち",
    ];

    /// 手合割つきの棋譜を読んでもパニックしない。
    ///
    /// v0.3.1 のクレートは手合割の盤面を表で持っておらず、表に無い5種
    /// （三枚落ち / 五枚落ち / 左五枚落ち / 右七枚落ち / 左七枚落ち）で
    /// `unimplemented!()` に落ちていた。走査は1ファイルずつ読むので、
    /// **1件混ざると索引作りがそこで死ぬ**。`catch_unwind` はそれを包むためにあった。
    ///
    /// 表が入って理由が消えたので包みを外した。外したままでよいことを、
    /// 落ちていた5種を含む全手合割で見る。
    #[test]
    fn every_handicap_reads_without_panicking() {
        let dir = std::env::temp_dir().join(format!(
            "obs-shogi-handicap-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        fs::create_dir_all(&dir).expect("一時ディレクトリ");

        for name in HANDICAPS {
            let path = dir.join(format!("{name}.kif"));
            fs::write(
                &path,
                format!(
                    "手合割：{name}\n\
                     手数----指手---------消費時間--\n   \
                     1 ３四歩(33)   ( 0:01/00:00:01)\n"
                ),
            )
            .expect("書き出し");

            let jkf = read_path_to_jkf(&path, KifuKind::Kif)
                .unwrap_or_else(|e| panic!("{name} が読めない: {e}"));
            assert_eq!(jkf.moves.len(), 2, "{name} の指し手数");
        }

        fs::remove_dir_all(&dir).ok();
    }
}
