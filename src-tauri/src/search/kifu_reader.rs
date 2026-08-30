use std::{
    fs,
    panic::catch_unwind,
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
/// そちらは `Cargo.lock` で 1.0.2 に固定されたまま入力由来の `unwrap` を残している。
///
/// | 入力 | どこで落ちるか |
/// | --- | --- |
/// | `$START_TIME:2004/02/30`（存在しない日付） | `csa-1.0.2/src/parser/time.rs:57` |
/// | 20桁の消費時間 `T99999999999999999999` | `csa-1.0.2/src/parser/game.rs:40` |
///
/// **他の3形式を包まないのは「安全だと分かっている」からではない。** 同じ形の
/// `unwrap` を `csa` にだけ実際に見つけた、というだけ。KIF / KI2 は `nom` を、
/// JKF は `serde_json` を通っており、どちらも
/// `shogi-kifu-converter` の `deny(clippy::unwrap_used)` の外側にある。
/// 同じ壊れ方が出たら上の表に行を足すこと。
///
/// 呼び口は `spawn_blocking` の中なのでプロセスは落ちないが、
/// 捕まえずに落ちると利用者に届くのが `spawn_blocking join error: task N panicked`
/// になり、どのファイルのどこが悪いのかが消える。
///
/// **文字コードの総当たりは掛けない。** クレートの `parse_csa_file` は
/// `read_to_string` するので UTF-8 以外は `Io` エラーになる。KIF / KI2 と揃っていないが、
/// 揃えるかどうかは #325 で決める。
fn parse_csa_guarded(path: &Path) -> Result<Jkf, KifuReadError> {
    match catch_unwind(|| parse_csa_file(path)) {
        Ok(result) => result.map_err(|e| parse_failed(path, e)),
        // パニックの中身を捨てない。上の表は実測した2件だが、`csa` には
        // 他にも `unwrap` があり、原因を決め打ちすると**違う理由を名指しする**
        Err(payload) => {
            let what = payload
                .downcast_ref::<&'static str>()
                .copied()
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("理由不明");
            Err(parse_failed(
                path,
                format!("CSA パーサが異常終了した: {what}"),
            ))
        }
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
    read_portable(path, |p| parse_kif_file(p), parse_kif_str)
}

fn parse_ki2_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    read_portable(path, |p| parse_ki2_file(p), parse_ki2_str)
}

/// クレートで読み、だめなら他の文字コードで読み直す。
///
/// クレートは拡張子が名乗る文字コードと Shift_JIS / UTF-8 のもう一方しか試さない
/// （`parser::read_kifu`）。実測でこの4つが残る。
///
/// | 文字コード | クレート単体 |
/// | --- | --- |
/// | EUC-JP | `Decode Error` |
/// | UTF-16LE / UTF-16BE | `Decode Error` |
/// | ISO-2022-JP | Shift_JIS として解釈が通ってしまい、指し手行で落ちる |
fn read_portable<File, Str>(
    path: &Path,
    from_file: File,
    from_str: Str,
) -> Result<Jkf, KifuReadError>
where
    File: Fn(&Path) -> Result<Jkf, ParseError>,
    Str: FnMut(&str) -> Result<Jkf, ParseError>,
{
    let by_crate = match from_file(path) {
        Ok(jkf) => return Ok(jkf),
        Err(e) => e,
    };

    let bytes = read_bytes(path)?;
    match try_other_encodings(&bytes, from_str) {
        Ok(jkf) => Ok(jkf),
        Err(by_fallback) => Err(parse_failed(path, describe(by_crate, by_fallback))),
    }
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, KifuReadError> {
    fs::read(path).map_err(|e| KifuReadError::ParseFailed {
        path: path.to_path_buf(),
        message: format!("io error: {e}"),
    })
}

/// クレートが試さない文字コード。上から順に試す
const ENCODINGS_THE_CRATE_SKIPS: [&Encoding; 4] = [UTF_16LE, UTF_16BE, EUC_JP, ISO_2022_JP];

/// クレートが自分で試す文字コード。利用者に「何を試したか」を出すときに使う
const ENCODINGS_THE_CRATE_TRIES: [&str; 2] = ["Shift_JIS", "UTF-8"];

/// `bytes` をこの文字コードとして読むのが筋の通る話か。
///
/// **UTF-16 は「読めてしまう」ので選り分けが要る。** 16bit の値はほとんどが有効な
/// 文字なので、Shift_JIS や EUC-JP のバイト列を UTF-16 として decode しても
/// 誤りが出ない。出てくるのは漢字の羅列で、棋譜としては1行目で落ちる。
/// それを「文字としては読めた」候補に数えると、**本当に読めた文字コードの
/// 理由を押しのける**（EUC-JP の4行目が読めない、が UTF-16 の1行目が読めない、になる）。
///
/// 本物の UTF-16 はどのバイト列よりも NUL を多く含む。ASCII と全角の混じった棋譜なら
/// 半分近くが NUL になるので、1つも無ければ UTF-16 ではない。
/// 8bit の文字コードに NUL は現れないので、この条件で取り違えない。
fn is_plausible(enc: &'static Encoding, bytes: &[u8]) -> bool {
    if enc == UTF_16LE || enc == UTF_16BE {
        return bytes.contains(&0);
    }
    true
}

/// 文字として読めたのに棋譜として読めなかった試行
struct Unparsable {
    encoding: &'static str,
    error: ParseError,
}

/// クレートが見ない文字コードで decode → parse を試す。
///
/// 読めなければ、**文字としては読めた試行**があればそれを返す。
/// 「どの文字コードでも読めなかった」と「EUC-JP としては読めたが4行目が棋譜でない」は
/// 利用者にとって別の話で、後者には直す手がある。
fn try_other_encodings<F>(bytes: &[u8], mut parse: F) -> Result<Jkf, Option<Unparsable>>
where
    F: FnMut(&str) -> Result<Jkf, ParseError>,
{
    let mut unparsable = None;

    for enc in ENCODINGS_THE_CRATE_SKIPS {
        if !is_plausible(enc, bytes) {
            continue;
        }
        let (cow, _, had_errors) = enc.decode(bytes);
        match parse(cow.as_ref()) {
            Ok(jkf) => return Ok(jkf),
            // 化けた文字列がたまたま棋譜として読めなかっただけかもしれないので、
            // **decode が誤りを出さなかった試行だけ**を理由の候補にする
            Err(error) if !had_errors && unparsable.is_none() => {
                unparsable = Some(Unparsable {
                    encoding: enc.name(),
                    error,
                })
            }
            Err(_) => {}
        }
    }

    // 最終手段。読めない位置を落として読み進める。
    // TODO(#293): 欠けたことを利用者に告げないまま索引へ入れている
    match parse(&String::from_utf8_lossy(bytes)) {
        Ok(jkf) => Ok(jkf),
        // lossy はどんなバイト列でも「読めた」ことになるので、理由の候補にしない
        Err(_) => Err(unparsable),
    }
}

/// 読めなかった理由を利用者に出す文言にする。
///
/// クレートの理由をそのまま使えるのは、クレートが**文字としては読めていた**とき
/// （`Kif` / `Ki2` / `Normalize`）。`Kif` / `Ki2` は何行目で止まったかを言い、
/// `Normalize` は何手目のどの手が局面に合わないかを言う。
///
/// `Decode` / `FileExtension` / `Io` のときはクレートが一語しか返さない
/// （`Decode` の Display は `Decode Error` だけ）ので、
/// 総当たりのほうが持っている理由を使う。どちらも無ければ試した文字コードを並べる。
fn describe(by_crate: ParseError, by_fallback: Option<Unparsable>) -> String {
    match by_crate {
        ParseError::Kif(_) | ParseError::Ki2(_) | ParseError::Normalize(_) => by_crate.to_string(),
        other => match by_fallback {
            Some(Unparsable { encoding, error }) => {
                format!("{encoding} としては読めたが、棋譜として読めなかった: {error}")
            }
            None => {
                let tried: Vec<&str> = ENCODINGS_THE_CRATE_TRIES
                    .iter()
                    .copied()
                    .chain(ENCODINGS_THE_CRATE_SKIPS.iter().map(|enc| enc.name()))
                    .collect();
                format!(
                    "{other}: {} のどれでも文字として読めなかった。\
                     棋譜ではないファイルに棋譜の拡張子が付いていないか確かめること",
                    tried.join(" / ")
                )
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::test_kifu::{one_move_kif, HANDICAPS};
    use crate::test_support::temp_dir;
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
        for enc in ENCODINGS_THE_CRATE_SKIPS {
            assert!(
                !message.to_lowercase().contains(&enc.name().to_lowercase()),
                "総当たりの失敗が理由を埋めている（{}）: {message}",
                enc.name()
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// どの文字コードでも文字として読めなかったときは、試した文字コードを添える。
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
        for enc in ENCODINGS_THE_CRATE_SKIPS {
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

    /// 文字としては読めたのに棋譜として読めなかったなら、その理由を出す。
    ///
    /// EUC-JP の棋譜に読めない行が1つあると、クレートは `Decode Error` を返す
    /// （クレートは EUC-JP を試さないので、文字にすらできない）。総当たりのほうは
    /// EUC-JP で文字にできているので**何行目が読めないかを知っている**。
    /// クレート側の一語を採ると、利用者は「文字コードを変換しろ」と言われて
    /// そのとおりにし、今度は別の理由で失敗する。
    #[test]
    fn a_file_that_decodes_but_does_not_parse_says_which_line() {
        let dir = temp_dir("decoded-but-unparsable");
        let path = dir.join("eucjp-bad-line.kif");
        // 「パス」は KIF の語彙に無い。文字コードは EUC-JP（クレートは試さない）
        let text = format!("{}   2 パス\n", hirate_kif());
        let (bytes, _, had_errors) = EUC_JP.encode(&text);
        assert!(!had_errors, "EUC-JP へ encode できること");
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("EUC-JP"),
            "どの文字コードで読めたかを言っていない: {message}"
        );
        assert!(
            message.contains("パス"),
            "読めなかった語を指していない: {message}"
        );
        assert!(
            !message.contains("UTF-16LE"),
            "試した文字コードを並べて理由を埋めている: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 手合割つきの棋譜が読める。
    ///
    /// 手合割の盤面はクレートの表（`handicap.rs`）が持つ。表に無い手合割は
    /// `ConvertError::UnknownPreset` になり、`normalize()` 経由で
    /// `ParseError::Normalize` として返る。**その棋譜だけが索引から漏れる**ので、
    /// 全種が読めることをここで固定する。
    #[test]
    fn every_handicap_is_readable() {
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
