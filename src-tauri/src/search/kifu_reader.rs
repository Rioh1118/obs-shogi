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

use encoding_rs::{EUC_JP, ISO_2022_JP, SHIFT_JIS, UTF_16BE, UTF_16LE};

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
    // 1) まずライブラリ標準（拡張子ベースのデコード）
    if let Ok(jkf) = parse_kif_file(path) {
        return Ok(jkf);
    }

    // 2) ダメなら "自前で bytes -> text" をやって parse_kif_str を総当たり
    let bytes = read_bytes(path)?;
    try_parse_text_with_fallback(path, &bytes, parse_kif_str)
}

fn parse_ki2_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    // 1) まずライブラリ標準
    if let Ok(jkf) = parse_ki2_file(path) {
        return Ok(jkf);
    }

    // 2) フォールバック
    let bytes = read_bytes(path)?;
    try_parse_text_with_fallback(path, &bytes, parse_ki2_str)
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, KifuReadError> {
    fs::read(path).map_err(|e| KifuReadError::ParseFailed {
        path: path.to_path_buf(),
        message: format!("io error: {e}"),
    })
}

/// いろんな文字コードで decode → parse を試す
///
/// 方針:
/// - UTF-8（BOMあり/なし）
/// - UTF-16LE/BE（BOMあり想定でも無理やり試す）
/// - Windows-31J(CP932) / Shift-JIS / EUC-JP / ISO-2022-JP
/// - 最後に UTF-8 lossy
fn try_parse_text_with_fallback<F>(
    path: &Path,
    bytes: &[u8],
    mut parse: F,
) -> Result<Jkf, KifuReadError>
where
    F: FnMut(&str) -> Result<Jkf, shogi_kifu_converter_obsshogi::error::ParseError>,
{
    let mut errs: Vec<String> = Vec::new();

    // --- UTF-8 (BOM strip) ---
    let utf8_bytes = strip_utf8_bom(bytes);
    if let Ok(s) = std::str::from_utf8(utf8_bytes) {
        match parse(s) {
            Ok(jkf) => return Ok(jkf),
            Err(e) => errs.push(format!("utf-8: {e:?}")),
        }
    } else {
        errs.push("utf-8: invalid bytes".to_string());
    }

    // --- UTF-16LE / UTF-16BE ---
    for (label, enc) in [("utf-16le", UTF_16LE), ("utf-16be", UTF_16BE)] {
        let (cow, _, had_errors) = enc.decode(bytes);
        let s = cow.as_ref();
        match parse(s) {
            Ok(jkf) => return Ok(jkf),
            Err(e) => errs.push(format!(
                "{label}{}: {e:?}",
                if had_errors { " (had_errors)" } else { "" }
            )),
        }
    }

    // --- Japanese legacy encodings ---
    for (label, enc) in [
        ("shift_jis", SHIFT_JIS),
        ("euc-jp", EUC_JP),
        ("iso-2022-jp", ISO_2022_JP),
    ] {
        let (cow, _, had_errors) = enc.decode(bytes);
        let s = cow.as_ref();
        match parse(s) {
            Ok(jkf) => return Ok(jkf),
            Err(e) => errs.push(format!(
                "{label}{}: {e:?}",
                if had_errors { " (had_errors)" } else { "" }
            )),
        }
    }

    // --- UTF-8 lossy (最終手段) ---
    {
        let s = String::from_utf8_lossy(utf8_bytes);
        match parse(&s) {
            Ok(jkf) => return Ok(jkf),
            Err(e) => errs.push(format!("utf-8 lossy: {e:?}")),
        }
    }

    Err(KifuReadError::ParseFailed {
        path: path.to_path_buf(),
        message: format!("all decode+parse attempts failed:\n- {}", errs.join("\n- ")),
    })
}

fn strip_utf8_bom(bytes: &[u8]) -> &[u8] {
    const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
    if bytes.len() >= 3 && bytes[0..3] == BOM {
        &bytes[3..]
    } else {
        bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
