use std::{
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
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
        KifuKind::Csa => safe_parse_csa(path),
        KifuKind::Jkf => safe_parse_jkf(path),
    }
}

/// CSA パーサーのパニックを捕捉してエラーに変換する
fn safe_parse_csa(path: &Path) -> Result<Jkf, KifuReadError> {
    match catch_unwind(AssertUnwindSafe(|| parse_csa_file(path))) {
        Ok(Ok(jkf)) => Ok(jkf),
        Ok(Err(e)) => Err(KifuReadError::ParseFailed {
            path: path.to_path_buf(),
            message: format!("{e:?}"),
        }),
        Err(_) => Err(KifuReadError::ParseFailed {
            path: path.to_path_buf(),
            message: "parser panicked (likely unsupported format)".to_string(),
        }),
    }
}

/// JKF パーサーのパニックを捕捉してエラーに変換する
fn safe_parse_jkf(path: &Path) -> Result<Jkf, KifuReadError> {
    match catch_unwind(AssertUnwindSafe(|| parse_jkf_file(path))) {
        Ok(Ok(jkf)) => Ok(jkf),
        Ok(Err(e)) => Err(KifuReadError::ParseFailed {
            path: path.to_path_buf(),
            message: format!("{e:?}"),
        }),
        Err(_) => Err(KifuReadError::ParseFailed {
            path: path.to_path_buf(),
            message: "parser panicked (likely unsupported format)".to_string(),
        }),
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
    // 1) まずライブラリ標準（拡張子ベースのデコード）を試す
    //    外部クレートのパーサーはカスタム初期局面でパニックする場合がある
    match catch_unwind(AssertUnwindSafe(|| parse_kif_file(path))) {
        Ok(Ok(jkf)) => return Ok(jkf),
        Ok(Err(_)) => {}
        Err(_) => {
            // パーサーがパニックした場合はフォールバックへ
        }
    }

    // 2) ダメなら "自前で bytes -> text" をやって parse_kif_str を総当たり
    let bytes = read_bytes(path)?;
    try_parse_text_with_fallback(path, &bytes, |s| {
        match catch_unwind(AssertUnwindSafe(|| parse_kif_str(s))) {
            Ok(result) => result,
            Err(_) => Err(shogi_kifu_converter_obsshogi::error::ParseError::Kif(
                "parser panicked".to_string(),
            )),
        }
    })
}

fn parse_ki2_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    // 1) まずライブラリ標準
    match catch_unwind(AssertUnwindSafe(|| parse_ki2_file(path))) {
        Ok(Ok(jkf)) => return Ok(jkf),
        Ok(Err(_)) => {}
        Err(_) => {}
    }

    // 2) フォールバック
    let bytes = read_bytes(path)?;
    try_parse_text_with_fallback(path, &bytes, |s| {
        match catch_unwind(AssertUnwindSafe(|| parse_ki2_str(s))) {
            Ok(result) => result,
            Err(_) => Err(shogi_kifu_converter_obsshogi::error::ParseError::Ki2(
                "parser panicked".to_string(),
            )),
        }
    })
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
