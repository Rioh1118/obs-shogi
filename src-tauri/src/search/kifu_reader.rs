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

/// 棋譜1つ分。クレートの JKF をそのまま使う
pub type Jkf = shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;

/// 棋譜を読めなかった理由
#[derive(Debug, Error)]
pub enum KifuReadError {
    /// どの文字コードでも、あるいは棋譜としても読めなかった。
    ///
    /// **`message` はそのまま利用者の画面に出る**（`project_manager` と `api` が
    /// `IndexWarnPayload` に詰め、`EVT_INDEX_WARN` で設定のワークスペースへ）。
    /// 内部の識別子ではなく、何が読めなかったかと次に何をすればよいかを入れること。
    #[error("parse failed: {path}: {message}")]
    ParseFailed { path: PathBuf, message: String },
}

/// 走査で見つけたファイルを JKF に読む
pub fn read_to_jkf(rec: &FileRecord) -> Result<Jkf, KifuReadError> {
    read_path_to_jkf(&rec.path, rec.kind)
}

/// 棋譜ファイルを JKF に読む。**形式ごとに手当てが違う。**
///
/// | 形式 | 文字コードの総当たり | パニックを捕まえる |
/// | --- | --- | --- |
/// | KIF / KI2 | する（`read_portable`） | しない |
/// | CSA | しない（クレートが UTF-8 のみ・#325） | **する**（`parse_csa_guarded`） |
/// | JKF | しない（JSON なので UTF-8） | しない |
///
/// 非対称の理由はそれぞれの関数の doc にある。
///
/// # Errors
///
/// [`KifuReadError::ParseFailed`] のみ。読めなかったファイルは索引に入らない。
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
/// になり、**どこが悪いのかが消える**（ファイル名は `IndexWarnPayload` が
/// 別の欄で持つので残る）。
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
                format!(
                    "CSA の値が規格外です。$START_TIME の日付と T 行の消費時間を\
                     確かめてください（内部の理由: {what}）"
                ),
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
    let evidence = Evidence::of(&bytes);
    match try_other_encodings(&bytes, &evidence, from_str) {
        Ok(jkf) => Ok(jkf),
        Err(by_fallback) => Err(parse_failed(
            path,
            describe(by_crate, &evidence, by_fallback),
        )),
    }
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, KifuReadError> {
    fs::read(path).map_err(|e| KifuReadError::ParseFailed {
        path: path.to_path_buf(),
        message: format!("io error: {e}"),
    })
}

/// クレートが試さない文字コード
const ENCODINGS_THE_CRATE_SKIPS: [&Encoding; 4] = [UTF_16LE, UTF_16BE, EUC_JP, ISO_2022_JP];

/// クレートが自分で試す文字コード。利用者に「何を試したか」を出すときに使う
const ENCODINGS_THE_CRATE_TRIES: [&str; 2] = ["Shift_JIS", "UTF-8"];

/// バイト列が名乗っている文字コード。分からなければ `None`。
///
/// **推測しない。そのバイト列にしか現れない印だけを見る。**
///
/// | 印 | 文字コード |
/// | --- | --- |
/// | BOM | UTF-8 / UTF-16LE / UTF-16BE |
/// | エスケープ `ESC $ B` / `ESC ( B` / `ESC ( J` | ISO-2022-JP |
///
/// # 統計で当てにいかない理由
///
/// NUL の数や偏りで UTF-16 を当てにいく書き方を3度試して3度とも外した。
///
/// 1. 「多いほうが勝ち」 → NUL が1バイト混じった Shift_JIS を UTF-16 と断定した
/// 2. 「NUL が全体の 1/4 以上」 → 全角の多い棋譜（KI2）が UTF-16 と認められなくなった
/// 3. 「反対側の番地の NUL が 1/8 未満」 → `一` や `　` は低位バイトが `0x00` なので
///    **反対側に NUL を置く**。一段目へ指す KI2 が落ちた
///
/// どれも「棋譜の中身の統計」に依存しており、題材を変えると壊れる。
/// 当てられなくても**読めなくなるわけではない**（読むのは
/// [`try_other_encodings`] の総当たり）。効くのは読めなかったときの文言だけなので、
/// 外して困る側より、嘘の文字コード名を出す側の害が大きい。
///
/// BOM の無い UTF-16 は名乗らない。総当たりが読むので開ける。
/// 読めなかったときに `UTF-16LE として…` と言えないだけ。
fn detect_encoding(bytes: &[u8]) -> Option<&'static Encoding> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some(encoding_rs::UTF_8);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some(UTF_16LE);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some(UTF_16BE);
    }
    if bytes
        .windows(3)
        .any(|w| w == b"\x1b$B" || w == b"\x1b(B" || w == b"\x1b(J")
    {
        return Some(ISO_2022_JP);
    }
    None
}

/// バイト列から一度だけ読み取る手掛かり。
///
/// `detected` は `bytes` から導ける値なので、別々に持ち回ると
/// **食い違った組を作れてしまう**（`detect_encoding` が返さない
/// `Some(EUC_JP)` を渡す、など）。1箇所で作って持ち回る。
struct Evidence {
    /// バイト列が名乗っている文字コード
    detected: Option<&'static Encoding>,
    /// 0x80 以上のバイトがあるか
    has_high_bytes: bool,
    /// 名乗った文字コードで復号したら化けたか。
    ///
    /// 化けるのは**ファイルが途中で切れている**か、別の文字コードが混ざっている印。
    /// 「その文字コードでは読めない」とは別の話で、利用者のすることも違う。
    declared_but_garbled: bool,
}

impl Evidence {
    fn of(bytes: &[u8]) -> Self {
        let detected = detect_encoding(bytes);
        Self {
            detected,
            has_high_bytes: bytes.iter().any(|b| *b >= 0x80),
            declared_but_garbled: detected.is_some_and(|enc| enc.decode(bytes).2),
        }
    }
}

/// この文字コードで読めた理由を、利用者に**その名前で**出してよいか。
///
/// **復号で1文字でも化けたら名乗らない。** 化けたまま「〜としては読めた」と出すと、
/// 利用者は文字コードが合っていると思い込み、本当の原因（途中で切れている、
/// 別の文字コードが混ざっている）に辿り着けない。
///
/// 印があればその文字コードだけ。印が無いときに名乗ってよいのは **EUC-JP だけ**で、
/// 消去法で決まる。
///
/// - UTF-16 は印（BOM か NUL の並び）が無ければ候補にしない。
///   印の無いバイト列でもほぼ必ず誤り無く復号できるので `had_errors` では弾けない
/// - ISO-2022-JP は必ずエスケープを持つので、印が無いなら ISO-2022-JP ではない
/// - Shift_JIS と UTF-8 はクレートが先に試しており、ここには来ない
///
/// ただし **8bit の文字が1つも無いなら、どの日本語文字コードの証拠でもない。**
/// ASCII だけのファイル（`.kif` に改名した CSA、SFEN のメモ）は EUC-JP としても
/// 誤り無く復号できてしまうので、名乗らせない。
fn can_be_named(enc: &'static Encoding, evidence: &Evidence, had_errors: bool) -> bool {
    if had_errors {
        return false;
    }
    match evidence.detected {
        Some(named) => named == enc,
        None => enc == EUC_JP && evidence.has_high_bytes,
    }
}

/// 文字として読めたのに棋譜として読めなかった試行
struct Unparsable {
    encoding: &'static str,
    error: ParseError,
}

/// クレートが見ない文字コードで decode → parse を試す。
///
/// 読めなければ、**バイト列が名乗っている文字コード**で読んだときの理由を返す。
/// 「どの文字コードでも読めなかった」と「ISO-2022-JP としては読めたが4行目が棋譜でない」は
/// 利用者にとって別の話で、後者には直す手がある。
///
/// 名乗っていないときに理由を返すのは EUC-JP だけ（消去法。条件は [`can_be_named`]）。
/// **どれで読めたかを言えないのに文字コード名を出すと、嘘になる。**
fn try_other_encodings<F>(
    bytes: &[u8],
    evidence: &Evidence,
    mut parse: F,
) -> Result<Jkf, Option<Unparsable>>
where
    F: FnMut(&str) -> Result<Jkf, ParseError>,
{
    let mut unparsable = None;

    for enc in ENCODINGS_THE_CRATE_SKIPS {
        let (cow, _, had_errors) = enc.decode(bytes);
        match parse(cow.as_ref()) {
            Ok(jkf) => return Ok(jkf),
            Err(error) if can_be_named(enc, evidence, had_errors) => {
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
/// **クレートが `Kif` / `Ki2` を返したことは「正しい文字コードで読めた」を意味しない。**
/// ISO-2022-JP の本文はすべて 0x80 未満なので、クレートの Shift_JIS 復号は誤りを出さず、
/// 化けたままの行を「読めない行」として名指しする。だから
/// **バイト列が別の文字コードを名乗っているなら、そちらの理由を先に採る。**
///
/// `Normalize` は文字コードと関係が無い（局面に合わない手）ので常にそのまま使う。
fn describe(by_crate: ParseError, evidence: &Evidence, by_fallback: Option<Unparsable>) -> String {
    if let ParseError::Normalize(_) = by_crate {
        return by_crate.to_string();
    }

    // バイト列が名乗った文字コードで読んだ理由があれば、それが一番確か
    if let Some(Unparsable { encoding, error }) = by_fallback {
        return format!("{encoding} としては読めたが、棋譜として読めなかった: {error}");
    }

    match by_crate {
        // クレートが文字にできていた。総当たりの対象は
        // `ENCODINGS_THE_CRATE_SKIPS` の4つだけで、Shift_JIS も UTF-8 もそこに無い。
        // BOM で UTF-8 と分かっていても絞り込む先が無いので、そのまま出す
        ParseError::Kif(_) | ParseError::Ki2(_) => by_crate.to_string(),
        other => {
            let tried: Vec<&str> = ENCODINGS_THE_CRATE_TRIES
                .iter()
                .copied()
                .chain(ENCODINGS_THE_CRATE_SKIPS.iter().map(|enc| enc.name()))
                .collect();
            match evidence.detected {
                // 復号が化けた＝バイト列そのものが欠けているか混ざっている。
                // 「棋譜として読めない」とは利用者のすることが違う
                Some(enc) if evidence.declared_but_garbled => format!(
                    "{} として読めましたが、途中に読めないバイトがあります。\
                     ファイルが途中で切れていないか確かめてください",
                    enc.name()
                ),
                Some(enc) => format!(
                    "{} を名乗っているが、その文字コードでも棋譜として読めなかった",
                    enc.name()
                ),
                // 「文字として読めなかった」と言い切れるのは 8bit の文字が
                // 1つも無いときだけ。復号が途中で化けた場合もここへ来るので、
                // 断定しない言い方にする
                None => format!(
                    "{other}: {} のどれでも棋譜として読めなかった。\
                     文字コードが壊れているか、棋譜ではないファイルに\
                     棋譜の拡張子が付いている可能性がある",
                    tried.join(" / ")
                ),
            }
        }
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
        // 0xFD / 0xFF は Shift_JIS / EUC-JP / UTF-8 のどれでも不正。
        // NUL も BOM もエスケープも含めない（含めると文字コードを名乗ったことになる）
        fs::write(&path, [0xFDu8, 0xFF, 0xFD, 0xFF, 0xFD]).expect("書き出し");

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

    /// ISO-2022-JP の棋譜は、Shift_JIS として「読めて」しまう。
    ///
    /// 本文が全て 0x80 未満なので、クレートの Shift_JIS 復号は誤りを出さず、
    /// **化けた行を「読めない行」として名指しする**。エスケープを見て
    /// ISO-2022-JP と分かるので、そちらの理由を採る。
    #[test]
    fn an_iso2022jp_file_is_not_explained_by_the_shift_jis_garbage() {
        let dir = temp_dir("iso2022-bad");
        let path = dir.join("bad-line.kif");
        let text = format!("{}   2 パス\n", hirate_kif());
        let (bytes, _, had_errors) = ISO_2022_JP.encode(&text);
        assert!(!had_errors, "ISO-2022-JP へ encode できること");
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("ISO-2022-JP"),
            "ISO-2022-JP と分かっていない: {message}"
        );
        assert!(
            message.contains("パス"),
            "化けた行のほうを名指ししている: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// BOM 付き UTF-16BE を UTF-16LE と取り違えない。
    ///
    /// バイト順を入れ替えた復号は UTF-16 ではまず誤りを出さないので、
    /// 「先に試したほうが勝つ」形にすると常に UTF-16LE を名乗ってしまう。
    /// 名乗るのは BOM を見たときだけにしてある。
    #[test]
    fn a_utf16be_file_is_not_called_utf16le() {
        let dir = temp_dir("utf16be-bad");
        let path = dir.join("bad-line.kif");
        let text = format!("{}   2 パス\n", hirate_kif());
        // BOM 付き。BOM が無ければ名乗らないので、バイト順を取り違えようが無い
        let mut bytes = vec![0xFEu8, 0xFF];
        bytes.extend(text.encode_utf16().flat_map(u16::to_be_bytes));
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("UTF-16BE"),
            "バイト順を取り違えている: {message}"
        );
        assert!(
            message.contains("パス"),
            "読めなかった語を指していない: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    fn to_utf16(text: &str, little_endian: bool) -> Vec<u8> {
        text.encode_utf16()
            .flat_map(|u| {
                if little_endian {
                    u.to_le_bytes()
                } else {
                    u.to_be_bytes()
                }
            })
            .collect()
    }

    /// `detect_encoding` は印だけを見る。**推測しない。**
    ///
    /// 「通してはいけない入力」と「通さねばならない入力」を対で並べる。
    /// 片方だけだと、判定をきつくして本物を落としても緑のまま通る。
    #[test]
    fn only_a_real_marker_names_an_encoding() {
        let kif = hirate_kif();
        let sjis = SHIFT_JIS.encode(&kif).0.into_owned();

        let cases: Vec<(&str, Vec<u8>, Option<&'static Encoding>)> = vec![
            // --- 名乗っていない ---
            ("空", vec![], None),
            ("1バイト", vec![b'a'], None),
            ("Shift_JIS", sjis.clone(), None),
            // NUL は印にしない。混じるだけで UTF-16 と決めた版が3度壊れた
            (
                "Shift_JIS + NUL 1つ",
                {
                    let mut v = sjis.clone();
                    v.push(0);
                    v
                },
                None,
            ),
            (
                "Shift_JIS + NUL 16個",
                {
                    let mut v = sjis.clone();
                    v.extend(std::iter::repeat_n(0u8, 16));
                    v
                },
                None,
            ),
            // BOM の無い UTF-16 は名乗らない。総当たりが読むので開ける
            ("BOM の無い UTF-16LE", to_utf16(&kif, true), None),
            ("BOM の無い UTF-16BE", to_utf16(&kif, false), None),
            // --- 名乗っている ---
            (
                "UTF-8 の BOM",
                vec![0xEF, 0xBB, 0xBF, b'a'],
                Some(encoding_rs::UTF_8),
            ),
            ("UTF-16LE の BOM", vec![0xFF, 0xFE, b'a', 0], Some(UTF_16LE)),
            ("UTF-16BE の BOM", vec![0xFE, 0xFF, 0, b'a'], Some(UTF_16BE)),
            (
                "ISO-2022-JP のエスケープ",
                ISO_2022_JP.encode(&kif).0.into_owned(),
                Some(ISO_2022_JP),
            ),
        ];

        for (label, bytes, expected) in cases {
            assert_eq!(
                detect_encoding(&bytes).map(|e| e.name()),
                expected.map(|e| e.name()),
                "{label}"
            );
        }
    }

    /// 名乗ってよい条件。化けていたら名乗らない。ASCII だけなら名乗らない。
    ///
    /// 手掛かりは `Evidence::of` でバイト列から作る。**手で組み立てない** —
    /// `detect_encoding` が返さない組（`Some(EUC_JP)` など）を書けてしまい、
    /// 起こり得ない状態を固定することになる。
    #[test]
    fn a_garbled_or_ascii_only_read_does_not_claim_an_encoding() {
        let japanese = SHIFT_JIS.encode(&hirate_kif()).0.into_owned();
        let ascii = b"V2.2\nPI\n+\n".to_vec();
        // 印は BOM で付ける。BOM の無い UTF-16 は名乗らない
        let mut utf16 = vec![0xFF, 0xFE];
        utf16.extend(to_utf16(&hirate_kif(), true));

        // 印が無いとき名乗ってよいのは EUC-JP だけ
        let plain = Evidence::of(&japanese);
        assert!(can_be_named(EUC_JP, &plain, false));
        assert!(!can_be_named(UTF_16LE, &plain, false));
        assert!(!can_be_named(ISO_2022_JP, &plain, false));

        // 8bit の文字が無いなら、どの日本語文字コードの証拠でもない
        assert!(!can_be_named(EUC_JP, &Evidence::of(&ascii), false));

        // 印があっても、復号で化けていれば名乗らない
        let marked = Evidence::of(&utf16);
        assert!(can_be_named(UTF_16LE, &marked, false));
        assert!(!can_be_named(UTF_16LE, &marked, true));
    }

    /// 棋譜でないファイルに棋譜の拡張子が付いていたら、そう言う。
    ///
    /// ASCII だけのファイルは EUC-JP としても誤り無く復号できるので、
    /// 「EUC-JP としては読めた」と名乗ると**文字コードを疑わせて遠回りさせる**。
    #[test]
    fn a_non_kifu_ascii_file_is_not_blamed_on_an_encoding() {
        let dir = temp_dir("ascii-not-kifu");
        let path = dir.join("actually-csa.kif");
        fs::write(&path, "V2.2\nPI\n+\n+7776FU\n%TORYO\n").expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            !message.contains("EUC-JP としては読めた"),
            "文字コードのせいにしている: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Shift_JIS の棋譜に NUL が1つ混じっても、理由は棋譜の側から出す。
    ///
    /// NUL は末尾を詰める書き出しや、途中で切れたファイルで現に出る。
    /// それで UTF-16 と断定すると、**クレートが正しく指していた行が消える**。
    #[test]
    fn one_stray_nul_does_not_turn_a_shift_jis_kifu_into_utf16() {
        let dir = temp_dir("stray-nul");
        let path = dir.join("trailing-nul.kif");
        let text = format!("{}   2 パス\n", hirate_kif());
        let mut bytes = SHIFT_JIS.encode(&text).0.into_owned();
        bytes.push(0);
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            !message.contains("UTF-16"),
            "NUL 1つで UTF-16 と決めつけている: {message}"
        );
        assert!(
            message.contains("パス"),
            "読めなかった語を指していない: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 途中で切れたファイルは「切れている」と言う。
    ///
    /// 名乗った文字コードで復号できたが化けた、は**バイト列が欠けている印**。
    /// 「その文字コードでは棋譜として読めない」と一緒にすると、
    /// 利用者は棋譜の中身を疑って、切れていることに辿り着けない。
    #[test]
    fn a_truncated_file_is_reported_as_truncated() {
        let dir = temp_dir("truncated");
        let path = dir.join("cut.kif");
        // BOM 付き UTF-16LE を1バイト欠けさせる。復号が末尾で化ける。
        // 末尾を落とすだけではパーサが通してしまうので、読めない語も入れておく
        let text = format!("{}   2 パス\n", hirate_kif());
        let mut bytes = vec![0xFFu8, 0xFE];
        bytes.extend(text.encode_utf16().flat_map(u16::to_le_bytes));
        bytes.pop();
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("切れて"),
            "切れていることを言っていない: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 手合割つきの棋譜が読める。
    ///
    /// 手合割の盤面はクレートの表（`handicap.rs`）が持つ。表に無い名前は
    /// **平手として素通しされ**（`Preset` の enum に無い名前は値にならない）、
    /// 上手の初手が指せずに `ParseError::Normalize(MakeMoveFailed)` で落ちる。
    /// **不正な手を記録した棋譜と見分けが付かない**ので、全種が読めることを
    /// ここで固定する。
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
