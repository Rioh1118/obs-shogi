use std::{
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
};

use thiserror::Error;

use crate::search::fs_scan::{FileRecord, KifuKind};

// shogi-kifu-converter
use shogi_kifu_converter_obsshogi::parser::{
    parse_csa_file, parse_jkf_file, parse_ki2_file, parse_ki2_str, parse_kif_file, parse_kif_str,
};

use encoding_rs::{Encoding, EUC_JP, ISO_2022_JP, UTF_16BE, UTF_16LE};
use shogi_kifu_converter_obsshogi::error::ParseError;

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
        KifuKind::Csa => parse_csa_guarded(path),
        KifuKind::Jkf => parse_jkf_file(path).map_err(|e| parse_failed(path, e)),
    }
}

/// CSA を読む。**パニックを捕まえるのはこの形式だけ。**
///
/// `shogi-kifu-converter` は CSA の本文を `csa` クレートに投げており、
/// そちらは `Cargo.lock` で 1.0.2 に固定されたまま `unwrap` を残している。
///
/// | 入力 | どこで落ちるか |
/// | --- | --- |
/// | `$START_TIME:2004/02/30`（存在しない日付） | `csa-1.0.2/src/parser/time.rs:57` |
/// | 20桁の消費時間 `T99999999999999999999` | `csa-1.0.2/src/parser/game.rs:40` |
///
/// `shogi-kifu-converter` v0.4.0 が `panic` / `unwrap` を lint で締め出したのは
/// **自分の crate の中だけ**で、`csa` には届かない。KIF / KI2 / JKF はその
/// lint の内側で完結するので包まない。
///
/// 呼び口は `spawn_blocking` の中なのでプロセスは落ちないが、
/// 捕まえずに落ちると利用者に届くのが `spawn_blocking join error: task N panicked`
/// になり、どのファイルのどこが悪いのかが消える。
fn parse_csa_guarded(path: &Path) -> Result<Jkf, KifuReadError> {
    match catch_unwind(AssertUnwindSafe(|| parse_csa_file(path))) {
        Ok(result) => result.map_err(|e| parse_failed(path, e)),
        Err(_) => Err(parse_failed(
            path,
            "CSA パーサが異常終了した（日付か消費時間の値が壊れている可能性がある）",
        )),
    }
}

fn parse_failed(path: &Path, e: impl std::fmt::Display) -> KifuReadError {
    KifuReadError::ParseFailed {
        path: path.to_path_buf(),
        message: e.to_string(),
    }
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
    try_other_encodings(&bytes, parse_kif_str).ok_or_else(|| parse_failed(path, reason_for(reason)))
}

fn parse_ki2_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    let reason = match parse_ki2_file(path) {
        Ok(jkf) => return Ok(jkf),
        Err(e) => e,
    };

    let bytes = read_bytes(path)?;
    try_other_encodings(&bytes, parse_ki2_str).ok_or_else(|| parse_failed(path, reason_for(reason)))
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
/// **読めなかったときに理由を返さないのは意図的。** ただしクレート側の理由が
/// 使えるのは、クレートがデコードまで通っていた場合だけ。使い分けは
/// [`reason_for`] が持つ。
fn try_other_encodings<F>(bytes: &[u8], mut parse: F) -> Option<Jkf>
where
    F: FnMut(&str) -> Result<Jkf, ParseError>,
{
    for enc in ATTEMPTED_ENCODINGS {
        let (cow, _, _) = enc.decode(bytes);
        if let Ok(jkf) = parse(cow.as_ref()) {
            return Some(jkf);
        }
    }

    // 最終手段。読めない位置を落として読み進める。
    // TODO(#293): 欠けたことを利用者に告げないまま索引へ入れている
    parse(&String::from_utf8_lossy(bytes)).ok()
}

/// クレートが試さない文字コード。`try_other_encodings` が上から順に試す
const ATTEMPTED_ENCODINGS: [&Encoding; 4] = [UTF_16LE, UTF_16BE, EUC_JP, ISO_2022_JP];

/// どの文字コードでも読めなかったときに利用者へ出す理由。
///
/// クレートの理由をそのまま使えるのは `Kif` / `Ki2` / `Normalize` のときだけで、
/// これらは「何行目の何が読めないか」を言う。**`Decode` の Display は
/// `Decode Error` の一語しかない。** そのまま出すと、利用者には
/// 「読めません」以上のことが何も残らないので、試した文字コードを添える。
fn reason_for(e: ParseError) -> String {
    match e {
        ParseError::Kif(_) | ParseError::Ki2(_) | ParseError::Csa(_) | ParseError::Normalize(_) => {
            e.to_string()
        }
        other => {
            let tried: Vec<&str> = std::iter::once("Shift_JIS")
                .chain(std::iter::once("UTF-8"))
                .chain(ATTEMPTED_ENCODINGS.iter().map(|enc| enc.name()))
                .collect();
            format!(
                "{other}: {} のどれでも読めなかった。エディタで UTF-8 に変換し直すと開けることがある",
                tried.join(" / ")
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::test_kifu::{one_move_kif, temp_dir, HANDICAPS};
    use encoding_rs::SHIFT_JIS;

    fn hirate_kif() -> String {
        one_move_kif("平手")
    }

    /// 拡張子が名乗る文字コードと中身が食い違うファイルを読む。
    ///
    /// クレートは拡張子の文字コードと Shift_JIS / UTF-8 のもう一方しか試さない。
    /// **`try_other_encodings` が要る根拠そのものをここで確かめる** — 各文字コードで
    /// クレート単体が失敗することを先に見てから、こちらが読めることを見る。
    /// クレートが将来この4つを自前で扱うようになれば前半が落ち、
    /// 総当たりを畳んでよいことがここで分かる。
    #[test]
    fn encodings_the_crate_does_not_try_are_still_read() {
        let dir = temp_dir("encoding");
        let hirate = hirate_kif();

        for (label, enc) in [
            ("eucjp", EUC_JP),
            ("iso2022", ISO_2022_JP),
            ("utf16le", UTF_16LE),
            ("utf16be", UTF_16BE),
        ] {
            let bytes: Vec<u8> = if enc == UTF_16LE || enc == UTF_16BE {
                // encoding_rs は UTF-16 へ encode できないので自分で組む
                hirate
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
                let (cow, _, had_errors) = enc.encode(&hirate);
                assert!(!had_errors, "{label} へ encode できること");
                cow.into_owned()
            };

            let path = dir.join(format!("{label}.kif"));
            fs::write(&path, &bytes).expect("書き出し");

            assert!(
                parse_kif_file(&path).is_err(),
                "{label} をクレート単体が読めてしまう。総当たりを畳めるか確かめること"
            );

            let jkf = read_path_to_jkf(&path, KifuKind::Kif)
                .unwrap_or_else(|e| panic!("{label} が読めない: {e}"));
            assert_eq!(jkf.moves.len(), 2, "{label} の指し手数");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// クレートが読めた上で拒んだのなら、その理由をそのまま返す。
    ///
    /// 文字コードの総当たりは、当たらなかったぶんの失敗を積むと**クレートが言った
    /// 具体的な理由を埋めてしまう**。パーサは読み残しのある入力をエラーにするので、
    /// この経路を通る棋譜が実際に出てくる。
    #[test]
    fn a_readable_file_the_parser_rejects_keeps_the_crates_reason() {
        let dir = temp_dir("reason");
        let path = dir.join("unknown-word.kif");
        // 「パス」は KIF の語彙に無い。文字コードは Shift_JIS で正しい
        let text = format!("{}   2 パス\n", hirate_kif());
        let (bytes, _, _) = SHIFT_JIS.encode(&text);
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("パス"),
            "読めなかった語を指していない: {message}"
        );
        for enc in ATTEMPTED_ENCODINGS {
            assert!(
                !message.to_lowercase().contains(&enc.name().to_lowercase()),
                "総当たりの失敗が理由を埋めている（{}）: {message}",
                enc.name()
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// どの文字コードでも読めなかったときは、試した文字コードを添える。
    ///
    /// クレートが返す `ParseError::Decode` の Display は `Decode Error` の一語しかない。
    /// そのまま出すと、利用者に「読めません」以外が何も残らない。
    #[test]
    fn a_file_no_encoding_can_decode_lists_what_was_tried() {
        let dir = temp_dir("undecodable");
        let path = dir.join("binary.kif");
        // どの日本語文字コードとしても解釈できず、棋譜としても読めないバイト列
        fs::write(&path, [0xC0u8, 0xC1, 0xF5, 0xFF, 0xFE, 0x00, 0x80]).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        for enc in ATTEMPTED_ENCODINGS {
            assert!(
                message.contains(enc.name()),
                "試した文字コード {} が出ていない: {message}",
                enc.name()
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// CSA は壊れた値でパニックせずエラーを返す。
    ///
    /// CSA の本文を読むのは `csa` クレートで、そちらは `unwrap` を残している。
    /// `shogi-kifu-converter` の lint はそこへ届かないので、
    /// `parse_csa_guarded` が捕まえる。
    #[test]
    fn a_csa_with_broken_values_is_an_error_not_a_panic() {
        let dir = temp_dir("csa");

        for (label, body) in [
            (
                "存在しない日付",
                "V2.2\n$START_TIME:2004/02/30 10:30:00\nPI\n+\n+7776FU\n%TORYO\n",
            ),
            (
                "桁あふれの消費時間",
                "V2.2\nPI\n+\n+7776FU\nT99999999999999999999\n%TORYO\n",
            ),
        ] {
            let path = dir.join(format!("{label}.csa"));
            fs::write(&path, body).expect("書き出し");

            let err = read_path_to_jkf(&path, KifuKind::Csa)
                .err()
                .unwrap_or_else(|| panic!("{label}: 読めてしまった"));
            assert!(
                err.to_string().contains(&path.display().to_string()),
                "{label}: どのファイルか言っていない: {err}"
            );
        }

        // 壊れていない CSA は読める。上のテストだけだと、CSA を常に失敗させても通る
        let ok_path = dir.join("ok.csa");
        fs::write(&ok_path, "V2.2\nPI\n+\n+7776FU\n%TORYO\n").expect("書き出し");
        let jkf = read_path_to_jkf(&ok_path, KifuKind::Csa).expect("正常な CSA が読めること");
        assert_eq!(jkf.moves.len(), 3, "指し手数");

        fs::remove_dir_all(&dir).ok();
    }

    /// 手合割つきの棋譜を読んでもパニックしない。
    ///
    /// 手合割の盤面はクレートの表（`handicap.rs`）が持つ。表に無い手合割は
    /// 初期局面を組むところで `unimplemented!()` に落ちるので、
    /// **1件混ざるとその棋譜が読めなくなる**。全種が読めることをここで固定する。
    #[test]
    fn every_handicap_reads_without_panicking() {
        let dir = temp_dir("handicap");

        for name in HANDICAPS {
            let path = dir.join(format!("{name}.kif"));
            fs::write(&path, one_move_kif(name)).expect("書き出し");

            let jkf = read_path_to_jkf(&path, KifuKind::Kif)
                .unwrap_or_else(|e| panic!("{name} が読めない: {e}"));
            assert_eq!(jkf.moves.len(), 2, "{name} の指し手数");
        }

        fs::remove_dir_all(&dir).ok();
    }
}
