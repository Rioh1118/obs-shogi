//! どの文字コードなら読めるかを決め、決められなければ根拠を残す。

use std::borrow::Cow;
use std::fs;
use std::path::Path;

use encoding_rs::{Encoding, EUC_JP, ISO_2022_JP, SHIFT_JIS, UTF_16BE, UTF_16LE};
use shogi_kifu_converter_obsshogi::error::ParseError;

use crate::kifu_text::declared_encoding;
use crate::search::read::diagnosis::{cannot_open, capped, parse_failed, unreadable_record};
use crate::search::read::outcome::{Jkf, KifuReadError};

/// クレートで読み、だめなら他の文字コードで読み直す。
///
/// クレートが試すのは2つだけ。KIF / KI2 は拡張子が名乗るほうと Shift_JIS / UTF-8 の
/// もう一方、CSA は UTF-8 と Shift_JIS（`parser.rs` の `decode_kifu`）。
/// ただし復号に `Encoding::decode` を使うので、**BOM があればそれに従う**
/// （BOM 付きの UTF-8 / UTF-16 はクレート単体で読める）。
///
/// 残るのは次の3つ。実測で確かめてある。
///
/// | 文字コード | クレート単体 |
/// | --- | --- |
/// | EUC-JP | `Decode Error` |
/// | **BOM の無い** UTF-16LE / UTF-16BE | `Decode Error`（CSA は本文が形にならず `Csa` エラー） |
/// | ISO-2022-JP | 7bit なので UTF-8 / Shift_JIS の復号が誤り無く通る |
///
/// # 総当たりはクレートが失敗したときにしか動かない
///
/// **クレートが化けたまま `Ok` を返す入力には届かない。** 届かない形が2つある。
/// どちらも「指し手行が ASCII で済む CSA」に効く — KIF / KI2 は化けた本文が
/// 指し手行の形にならずクレートが落ちるので、総当たりが動く。
///
/// - **ISO-2022-JP。** 7bit なので UTF-8 の復号が誤り無く通る。
///   対局者名にエスケープが残ったまま索引に入る
/// - **EUC-JP のうち、Shift_JIS としても誤り無く復号できるバイト列。**
///   EUC-JP は 0xA1〜0xFE、Shift_JIS はそのうち 0xA1〜0xDF を半角カナに割り当てる。
///   本文が短いと全部が半角カナに落ちて Shift_JIS が勝つ
///   （`N+山田太郎` だけの CSA は `ｻｳﾅﾄﾂﾀﾏｺ` になる）
///
/// 直すならクレートの側 — 復号の候補を増やすか、化けを疑う手掛かりを
/// 復号の結果から採るか（#325）。
pub(crate) fn read_portable<File, Str>(
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
    try_the_rest(&bytes, by_crate, from_str)
}

/// [`read_portable`] のバイト列版。**CSA はこちらを通る。**
///
/// CSA だけ別なのは、読み残しの検査（[`warn_if_moves_were_dropped`]）が
/// **同じバイト列**を要るから。path を渡す形だと、パースと検査が別々に読んで
/// 「同じファイルを見ているか」を型で表せない。
pub(crate) fn read_portable_bytes<First, Str>(
    bytes: &[u8],
    first: First,
    from_str: Str,
) -> Result<Jkf, KifuReadError>
where
    First: Fn(&[u8]) -> Result<Jkf, ParseError>,
    Str: FnMut(&str) -> Result<Jkf, ParseError>,
{
    let by_crate = match first(bytes) {
        Ok(jkf) => return Ok(jkf),
        Err(e) => e,
    };
    try_the_rest(bytes, by_crate, from_str)
}

/// クレートが読めなかったあとの総当たり。両方の入口から使う
pub(crate) fn try_the_rest<Str>(
    bytes: &[u8],
    by_crate: ParseError,
    from_str: Str,
) -> Result<Jkf, KifuReadError>
where
    Str: FnMut(&str) -> Result<Jkf, ParseError>,
{
    let evidence = Evidence::of(bytes);
    match try_other_encodings(bytes, &evidence, from_str) {
        Ok(jkf) => Ok(jkf),
        Err(by_fallback) => Err(parse_failed(describe(by_crate, &evidence, by_fallback))),
    }
}

pub(crate) fn read_bytes(path: &Path) -> Result<Vec<u8>, KifuReadError> {
    fs::read(path).map_err(cannot_open)
}

/// クレートが試さない文字コード。**[`KIFU_ENCODINGS`] から
/// クレートの2つ（UTF-8 / Shift_JIS）を除いたもの。**
///
/// 並びは [`KIFU_ENCODINGS`] と揃える必要が無い — ここを通るのは
/// **クレートが読めなかったバイト列だけ**で、どれで読めても
/// パーサが通ったものを採るため。揃っていることは
/// `the_skipped_encodings_are_the_shared_list_minus_the_crates_two` が見る。
pub(crate) const ENCODINGS_THE_CRATE_SKIPS: [&Encoding; 4] =
    [UTF_16LE, UTF_16BE, EUC_JP, ISO_2022_JP];

/// クレートが自分で試す文字コードの名前。**利用者に見せる文字列でしかない。**
///
/// 並びは読ませる順ではなく、[`ENCODINGS_THE_CRATE_SKIPS`] と繋いで
/// 「何を試したか」を並べるためのもの。実際に復号を試す順は形式ごとに違う
/// （CSA は [`CRATE_CSA_DECODE_ORDER`]）。**この定数を復号に使わないこと。**
pub(crate) const CRATE_ENCODING_NAMES: [&str; 2] = ["Shift_JIS", "UTF-8"];

/// バイト列から一度だけ読み取る手掛かり。
///
/// `declared` は `bytes` から導ける値なので、別々に持ち回ると
/// **食い違った組を作れてしまう**（[`declared_encoding`] が返さない
/// `Some(EUC_JP)` を渡す、など）。1箇所で作って持ち回る。
pub(crate) struct Evidence {
    /// バイト列が名乗っている文字コード
    declared: Option<&'static Encoding>,
    /// 0x80 以上のバイトがあるか
    has_high_bytes: bool,
    /// 名乗った文字コードで復号したら化けたか。
    ///
    /// 化けるのは**ファイルが途中で切れている**か、別の文字コードが混ざっている印。
    /// 「その文字コードでは読めない」とは別の話で、利用者のすることも違う。
    declared_but_garbled: bool,
}

impl Evidence {
    pub(crate) fn of(bytes: &[u8]) -> Self {
        let declared = declared_encoding(bytes);
        Self {
            declared,
            has_high_bytes: bytes.iter().any(|b| *b >= 0x80),
            declared_but_garbled: declared.is_some_and(|enc| enc.decode(bytes).2),
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
/// - UTF-16 は BOM が無ければ名前を出さない。BOM の無いバイト列でも
///   ほぼ必ず誤り無く復号できるので、`had_errors` では EUC-JP と区別が付かない
/// - ISO-2022-JP は必ずエスケープを持つので、印が無いなら ISO-2022-JP ではない
/// - Shift_JIS と UTF-8 はクレートが先に試しており、ここには来ない
///
/// ただし**印が無いとき**は、8bit の文字が1つも無ければ EUC-JP の証拠でもない。
/// ASCII だけのファイル（`.kif` に改名した CSA、SFEN のメモ）は EUC-JP としても
/// 誤り無く復号できてしまうので、名乗らせない。
/// （印がある側では見ない。ISO-2022-JP は 7bit なので、そこで弾くと必ず落ちる）
///
/// 名乗れなかった試行をどう扱うかは [`try_other_encodings`] が決める。
pub(crate) fn can_be_named(enc: &'static Encoding, evidence: &Evidence, had_errors: bool) -> bool {
    if had_errors {
        return false;
    }
    match evidence.declared {
        Some(named) => named == enc,
        None => enc == EUC_JP && evidence.has_high_bytes,
    }
}

/// 文字として読めたのに棋譜として読めなかった試行
pub(crate) struct Unparsable {
    /// どの文字コードで読めたか。**化けずに読めたが名乗れないときは `None`。**
    ///
    /// 名前を出せないことと、理由（何行目で止まったか）を出せないことは別。
    /// 名前が無くても行番号は利用者の役に立つ。
    pub(crate) encoding: Option<&'static str>,
    /// どこで止まったか
    pub(crate) error: ParseError,
}

/// クレートが見ない文字コードで decode → parse を試す。
///
/// 読めなければ、**誤り無く復号できた試行**の理由を返す。名乗ってよい文字コード
/// （[`can_be_named`]）があればそれを優先し、無ければ名前を伏せて理由だけ返す。
/// 名乗れない候補が複数あるときは、**行数が一番多いもの**（[`line_count`]）。
///
/// 「どの文字コードでも読めなかった」と「4行目が棋譜として読めない」は
/// 利用者にとって別の話で、後者には直す手がある。
pub(crate) fn try_other_encodings<F>(
    bytes: &[u8],
    evidence: &Evidence,
    mut parse: F,
) -> Result<Jkf, Option<Unparsable>>
where
    F: FnMut(&str) -> Result<Jkf, ParseError>,
{
    let mut named = None;
    // 名乗れない候補は**行数が一番多いもの**を採る。並び順で決めると、
    // バイト順を取り違えた UTF-16（1行にまとまる）が先にあるだけで勝ってしまう。
    // 同点の扱いは [`line_count`]
    let mut anonymous: Option<(usize, Unparsable)> = None;

    for enc in ENCODINGS_THE_CRATE_SKIPS {
        let (cow, _, had_errors) = enc.decode(bytes);
        let lines = line_count(&cow);
        let error = match parse(&cow) {
            Ok(jkf) => return Ok(jkf),
            Err(error) => error,
        };

        if can_be_named(enc, evidence, had_errors) {
            // `can_be_named` は1つのバイト列について高々1つの文字コードにしか
            // 真を返さない（印があればその1つ、無ければ EUC-JP だけ）ので、
            // ここが2度通ることはない
            named = Some(Unparsable {
                encoding: Some(enc.name()),
                error,
            });
        } else if !had_errors {
            // 名乗れないが文字にはできた。行番号だけでも利用者の役に立つ
            if anonymous.as_ref().map_or(true, |(best, _)| lines > *best) {
                anonymous = Some((
                    lines,
                    Unparsable {
                        encoding: None,
                        error,
                    },
                ));
            }
        }
    }

    // 最終手段。誤りを落として読み進める（[`LOSSY_DECODERS`]）。
    //
    // **中身を認識できなかった復号はクレートが断る**（`parser.rs` の
    // `recognised_nothing`）ので、まるごと化けた読み方が「0手の棋譜」として
    // ここで勝つことはない。残る危うさは、化けたヘッダ行が下の行を飲み込む形
    // ——指し手は残るが `手合割` が消えて平手として索引に入る（#335）
    for decode in LOSSY_DECODERS {
        if let Ok(jkf) = parse(&decode(bytes)) {
            return Ok(jkf);
        }
    }

    // 誤りを落としても読めない。理由の候補にはしない
    // （誤りを落とした復号が指す位置は元のファイルの位置と合わない）
    Err(named.or_else(|| anonymous.map(|(_, u)| u)))
}

/// 復号した結果が何行になったか。**候補どうしを比べるためだけに使う。**
///
/// バイト順を取り違えた UTF-16 を弾くのが目的。UTF-16 は LE と BE のどちらで
/// 読んでもほとんど誤りが出ないので `had_errors` では当てにできないが、取り違えると
/// 改行 `U+000A` が `U+0A00` になり、**行が1つにまとまる**。
/// 改行が1つでもある棋譜なら、正しい読み方のほうが行数が多い。
/// **1行しか無い棋譜では同数になる** — そのときは先に試したほうを採る。
/// 行番号はどちらも1行目だが、**引用される行の本文は違う**（クレートは
/// 読めなかった行をそのまま引用する。`nom` の `convert_error`）。
/// **1行しか無い候補では行数で差が付かない。** NUL の位置や数で
/// バイト順を当てにいかない理由は [`declared_encoding`] の表にある。
///
/// **「改行があること」を通過条件にはしない。** 1行しかない KI2 は正当な入力で、
/// 候補が1つならそれを採る。落とすのは
/// 「他にもっと行数の多い読み方があるとき」だけ。
pub(crate) fn line_count(decoded: &str) -> usize {
    decoded.lines().count()
}

/// 誤りを落とす復号1つ
pub(crate) type LossyDecoder = fn(&[u8]) -> Cow<'_, str>;

/// 誤りを落として読む復号。**上から順に試す。**
///
/// クレートは誤りが1つでもある復号を捨てて `Decode` を返す
/// （`parser.rs` の `decode_kifu` は `!had_errors` のときしか採らない）ので、
/// **Shift_JIS も UTF-8 もここで試し直す**。KIF の既定は Shift_JIS なので、
/// 1バイト壊れただけの棋譜がここに来る。
///
/// **並びは取り違えを防いでいない。** 実測すると、UTF-8 の棋譜を
/// Shift_JIS で落として読んでも、その逆でも `parse` は通らない
/// （化けた本文は指し手行の形にならない）。並びが決めるのは
/// **どちらを先に試すか＝どちらで読めたときに復号1本ぶん安く済むか**だけ。
pub(crate) const LOSSY_DECODERS: [LossyDecoder; 2] = [
    |bytes| String::from_utf8_lossy(bytes),
    |bytes| SHIFT_JIS.decode(bytes).0,
];

/// 読めなかった理由を利用者に出す文言にする。
///
/// 優先順は次のとおり。**上から順に、より確かなものを採る。**
///
/// 1. `Normalize` — 文字コードと関係が無い（局面に合わない手）。そのまま出す
/// 2. 名乗った文字コードで復号が化けた — バイト列そのものが欠けている印。
///    **クレートが `Kif` を返していても、こちらを先に採る**（下）
/// 3. 総当たりが**名乗れる文字コード**で読んだ理由 — 何行目で止まったかを言う
/// 4. クレートが文字にできていた（`Kif` / `Ki2` / `Csa` / `CsaConvert`）— その理由をそのまま出す
/// 5. 総当たりが名乗れない文字コードで読んだ理由 — 名前を伏せて行番号だけ出す
/// 6. どれでもない — 試した文字コードを並べる
///
/// 5 が 4 より後なのは、**どの文字コードでもたいてい誤り無く復号できてしまう**から。
/// Shift_JIS の棋譜は UTF-16 としても化けずに読めて、化けた1行目で止まる。
/// それを先に採ると、クレートが正しく指した行を押しのける。
///
/// 2 が 4 より先なのは、**ISO-2022-JP の本文がすべて 0x80 未満**だから。
/// クレートの Shift_JIS 復号は誤りを出さず `Kif` を返すので、4 を先に見ると
/// 切れた ISO-2022-JP のファイルが「この行が読めない」と**化けた行を名指し**する。
pub(crate) fn describe(
    by_crate: ParseError,
    evidence: &Evidence,
    by_fallback: Option<Unparsable>,
) -> String {
    if let ParseError::Normalize(_) = by_crate {
        return unreadable_record(by_crate);
    }

    if let (Some(enc), true) = (evidence.declared, evidence.declared_but_garbled) {
        return format!(
            "{} として読めましたが、途中に読めないバイトがあります。\
             ファイルが途中で切れていないか確かめてください",
            enc.name()
        );
    }

    if let Some(Unparsable {
        encoding: Some(name),
        error,
    }) = &by_fallback
    {
        // **クレート経路と同じ案内を付ける。** 同じ壊れ方でも、文字コードが
        // Shift_JIS / UTF-8 なら `unreadable_record` が案内を付け、
        // EUC-JP / BOM 無しの UTF-16 / ISO-2022-JP はここに落ちる。
        // 付けないと、文字コードによって案内が出たり出なかったりする
        return format!(
            "{name} としては読めましたが、棋譜として読めない行があります。\
             その行を直すか、拡張子が中身と合っているか確かめてください:\n{}",
            capped(error)
        );
    }

    match by_crate {
        // クレートが文字にできていた。総当たりの対象は
        // `ENCODINGS_THE_CRATE_SKIPS` の4つだけで、Shift_JIS も UTF-8 もそこに無い。
        // BOM で UTF-8 と分かっていても絞り込む先が無いので、そのまま出す。
        // **形式ごとの案内は `unreadable_record` が持つ**ので、3形式とも通す
        ParseError::Kif(_)
        | ParseError::Ki2(_)
        | ParseError::Csa(_)
        | ParseError::CsaConvert(_) => unreadable_record(by_crate),
        // クレートも文字にできなかった。誤り無く復号できた試行があれば、
        // 名前は伏せて理由だけ使う
        other => match by_fallback {
            Some(Unparsable { error, .. }) => {
                format!(
                    "文字コードは特定できませんが、棋譜として読めない行があります。\
                     その行を直すか、拡張子が中身と合っているか確かめてください:\n{}",
                    capped(&error)
                )
            }
            None => {
                let tried: Vec<&str> = CRATE_ENCODING_NAMES
                    .iter()
                    .copied()
                    .chain(ENCODINGS_THE_CRATE_SKIPS.iter().map(|enc| enc.name()))
                    .collect();
                format!(
                    "{}: {} のどれでも文字として読めませんでした。\
                         棋譜ではないファイルに棋譜の拡張子が付いていないか確かめてください",
                    capped(&other),
                    tried.join(" / ")
                )
            }
        },
    }
}
