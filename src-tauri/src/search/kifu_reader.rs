use std::{borrow::Cow, fs, panic::catch_unwind, path::Path};

use thiserror::Error;

use crate::search::fs_scan::{FileRecord, KifuKind};

// shogi-kifu-converter
use shogi_kifu_converter_obsshogi::parser::{
    parse_csa_file, parse_jkf_file, parse_ki2_file, parse_ki2_str, parse_kif_file, parse_kif_str,
};

use encoding_rs::{Encoding, EUC_JP, ISO_2022_JP, SHIFT_JIS, UTF_16BE, UTF_16LE};
use shogi_kifu_converter_obsshogi::error::ParseError;

/// 棋譜1つ分。クレートの JKF をそのまま使う
pub type Jkf = shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;

/// 棋譜を読めなかった理由
#[derive(Debug, Error)]
pub enum KifuReadError {
    /// どの文字コードでも、あるいは棋譜としても読めなかった。
    ///
    /// **これがそのまま利用者の画面に出る**（`project_manager` と `api` が
    /// `to_string()` して `IndexWarnPayload` に詰め、`EVT_INDEX_WARN` で
    /// 設定のワークスペースへ）。内部の識別子ではなく、
    /// 何が読めなかったかと次に何をすればよいかを入れること。
    ///
    /// **どのファイルかは持たない。** 呼び手が `IndexWarnPayload` の別の欄で
    /// 持っており、画面はその欄と本文を並べて描くので、入れると同じパスが2回出る。
    #[error("{0}")]
    ParseFailed(String),
}

/// 走査で見つけたファイルを JKF に読む
pub fn read_to_jkf(rec: &FileRecord) -> Result<Jkf, KifuReadError> {
    read_path_to_jkf(&rec.path, rec.kind)
}

/// 誤りを落として読む復号。上から順に試す。
///
/// KIF の既定は Shift_JIS で、UTF-8 で書かれたものも多い。
/// クレートはどちらも**誤りの無い復号しか採らない**ので、
/// 1バイト壊れた棋譜はここまで来る。
/// 誤りを落とす復号1つ
type LossyDecoder = fn(&[u8]) -> Cow<'_, str>;

const LOSSY_DECODERS: [LossyDecoder; 2] = [
    |bytes| String::from_utf8_lossy(bytes),
    |bytes| SHIFT_JIS.decode(bytes).0,
];

/// 読めた記録が、何も言っていないか。
///
/// **パーサは中身の無いファイルを「平手の初期局面1件」として `Ok` で返す。**
/// 索引に入ると平手の初期局面で検索したときに全部ヒットし、開いても
/// 初期局面しか出ないので「そういう棋譜」と誤解される。警告も出ない。
/// 保存が途中で終わった / 同期が失敗した跡なので、ここで弾く。
///
/// # バイト列でなく、読めた記録の形で決める
///
/// **バイト列を先に検査すると、検査した文字コードの集合と、
/// あとで実際に読み通す集合とがずれる。** 読み手が通すのは
/// クレートの2つ・[`ENCODINGS_THE_CRATE_SKIPS`] の4つ・[`LOSSY_DECODERS`] の2つで、
/// 事前の門でそれを再現しようとすると、増やすたびに片方だけ増えて穴が空く。
/// **同じ穴が5回開いた。** 題材を足すのではなく、判定する場所を
/// 「読み通したあと」へ動かすことでしか閉じない。
///
/// ここまで来たら文字コードの話は終わっている。残るのは
/// **その記録が何か言っているか**だけで、それは JKF の形で分かる。
///
/// 見るのは4つ。1つでも埋まっていれば通す。
///
/// | 欄 | 埋まる例 |
/// | --- | --- |
/// | 指し手が2件以上 | 1手でも指されていれば `moves` は初期局面ぶんと合わせて2件 |
/// | ヘッダ | `先手：` `棋戦：` などが1つでもある |
/// | 初期局面 | 盤面が書いてある、平手以外の手合割 |
/// | 最初の局面の注釈・終局 | `*` のコメント、`投了` だけの記録 |
///
/// **`手合割：平手` だけの記録は空と区別できない** — 平手の初期局面は
/// 何も書かなかったときと同じ値になる。区別する意味も無い（どちらも
/// 索引に入れる中身が無い）。
fn says_nothing(jkf: &Jkf) -> bool {
    use shogi_kifu_converter_obsshogi::jkf::Preset;

    if jkf.moves.len() > 1 || !jkf.header.is_empty() {
        return false;
    }
    if let Some(initial) = &jkf.initial {
        if initial.data.is_some() || initial.preset != Preset::PresetHirate {
            return false;
        }
    }
    jkf.moves
        .first()
        .map_or(true, |m| m.comments.is_none() && m.special.is_none())
}

/// 利用者に出す文言の上限。
///
/// クレートのエラーは**読めなかった位置から行末までを引用する**ので、
/// 改行を含まない大きなファイル（`.kif` に改名した zip など）では
/// ファイルの中身がそのまま文言になる。これが `IndexWarnPayload` に載り、
/// webview の state に200件まで溜まる。
const MESSAGE_LIMIT: usize = 300;

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
/// [`KifuReadError::ParseFailed`] のみ。**読めなかったファイルが索引にどう残るかは
/// 呼び口で違う** — 差分更新（`project_manager`）は登録せず、全件構築（`api`）は
/// 局面を1つも持たない項目として登録する（#333）。
/// どちらの経路でも、その棋譜の局面は検索に出てこない。
pub fn read_path_to_jkf(path: &Path, kind: KifuKind) -> Result<Jkf, KifuReadError> {
    // ファイルそのものを開けるかを、形式ごとの分岐より前に1度だけ見る。
    // CSA / JKF はクレートが自分で開くので、ここを通さないと
    // `Permission denied (os error 13)` が生のまま画面に出る
    match fs::File::open(path) {
        Ok(_) => {}
        Err(e) => return Err(unreadable(e)),
    }

    let jkf = match kind {
        KifuKind::Kif => parse_kif_portable(path),
        KifuKind::Ki2 => parse_ki2_portable(path),
        KifuKind::Csa => parse_csa_guarded(path),
        KifuKind::Jkf => parse_jkf_file(path).map_err(parse_failed),
    }?;

    if says_nothing(&jkf) {
        return Err(parse_failed(
            "棋譜として中身がありません。保存が途中で終わっていないか確かめてください",
        ));
    }
    Ok(jkf)
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
        Ok(result) => result.map_err(parse_failed),
        // パニックの中身を捨てない。上の表は実測した2件だが、`csa` には
        // 他にも `unwrap` があり、原因を決め打ちすると**違う理由を名指しする**
        Err(payload) => {
            let what = payload
                .downcast_ref::<&'static str>()
                .copied()
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("理由不明");
            Err(parse_failed(format!(
                "CSA の値が規格外です。$START_TIME の日付と T 行の消費時間を\
                     確かめてください（内部の理由: {what}）"
            )))
        }
    }
}

/// 読めなかった理由を、利用者に出せる形にして包む。
///
/// **`KifuReadError` を作る口はここだけ。** 長さと制御文字を落とすのを
/// 各所でやると必ず漏れる。
fn parse_failed(e: impl std::fmt::Display) -> KifuReadError {
    let raw = e.to_string();
    // 制御文字は画面に出しても意味が無く、生の NUL やエスケープが混ざる
    let mut message: String = raw
        .chars()
        .map(|c| if c == '\n' || !c.is_control() { c } else { ' ' })
        .collect();
    if message.chars().count() > MESSAGE_LIMIT {
        message = message.chars().take(MESSAGE_LIMIT).collect::<String>() + "…";
    }
    KifuReadError::ParseFailed(message)
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
/// クレートが試すのは拡張子が名乗る文字コードと Shift_JIS / UTF-8 のもう一方だけ
/// （`parser::read_kifu`）。ただし復号に `Encoding::decode` を使うので、
/// **BOM があればそれに従う**（BOM 付きの UTF-8 / UTF-16 はクレート単体で読める）。
///
/// 残るのは次の3つ。実測で確かめてある。
///
/// | 文字コード | クレート単体 |
/// | --- | --- |
/// | EUC-JP | `Decode Error` |
/// | **BOM の無い** UTF-16LE / UTF-16BE | `Decode Error` |
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
        Err(by_fallback) => Err(parse_failed(describe(by_crate, &evidence, by_fallback))),
    }
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, KifuReadError> {
    fs::read(path).map_err(unreadable)
}

/// ファイルそのものを読めなかったときの文言。
///
/// **`os error 13` から権限を疑える利用者はいない。** この経路の文言も
/// 索引の警告としてそのまま画面に出るので、他と同じく次の行動まで言う。
fn unreadable(e: std::io::Error) -> KifuReadError {
    let what = match e.kind() {
        std::io::ErrorKind::PermissionDenied => {
            "ファイルを開く権限がありません。権限を確かめるか、この場所を索引から外してください"
                .to_owned()
        }
        std::io::ErrorKind::NotFound => "索引を作っている間にファイルが無くなりました".to_owned(),
        // `ErrorKind` の Debug は内部の識別子なので出さない
        _ => {
            "ファイルを読めませんでした。ディスクやネットワークの接続を確かめてください".to_owned()
        }
    };
    parse_failed(what)
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
/// | エスケープ `ESC $ B` | ISO-2022-JP |
///
/// # NUL の数や偏りで UTF-16 を当てにいかないこと
///
/// 素直に見えるが、どれも棋譜の中身の統計に依存していて反例がある。
///
/// | 規則 | 反例 |
/// | --- | --- |
/// | NUL が多いほうの番地でバイト順を決める | NUL が1バイト混じった Shift_JIS が UTF-16 になる |
/// | NUL が全体の 1/4 以上なら UTF-16 | 全角の多い KI2 が UTF-16 と認められない |
/// | 反対側の番地の NUL が 1/8 未満なら UTF-16 | `一` `　` は低位バイトが `0x00` なので反対側に NUL を置く。一段目へ指す KI2 が落ちる |
///
/// 当てられなくても**読めなくなるわけではない**（読むのは
/// [`try_other_encodings`] の総当たり）。効くのは読めなかったときの文言だけなので、
/// 当てにいって嘘の文字コード名を出す側の害のほうが大きい。
///
/// BOM の無い UTF-16 は名乗らない。総当たりが読むので開ける。
/// 読めなかったときに `UTF-16LE として…` と言えないだけ。
fn declared_encoding(bytes: &[u8]) -> Option<&'static Encoding> {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some(encoding_rs::UTF_8);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some(UTF_16LE);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some(UTF_16BE);
    }
    // 見るのは `ESC $ B`（JIS X 0208 へ切り替える）だけ。
    // `ESC ( B` / `ESC ( J` は ASCII へ戻す指示で、**ASCII のファイルにも現れうる**ので
    // ISO-2022-JP である証拠にならない。
    //
    // 7bit かどうかはここでは見ない。ISO-2022-JP は定義上 7bit なので、
    // 0x80 以上があれば**そのファイルが壊れている**（途中で切れた、別の文字コードが
    // 混ざった）。それは `Evidence::declared_but_garbled` が拾って、
    // 「切れていないか」と案内する側の話になる。
    if bytes.windows(3).any(|w| w == b"\x1b$B") {
        return Some(ISO_2022_JP);
    }
    None
}

/// バイト列から一度だけ読み取る手掛かり。
///
/// `declared` は `bytes` から導ける値なので、別々に持ち回ると
/// **食い違った組を作れてしまう**（[`declared_encoding`] が返さない
/// `Some(EUC_JP)` を渡す、など）。1箇所で作って持ち回る。
struct Evidence {
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
    fn of(bytes: &[u8]) -> Self {
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
fn can_be_named(enc: &'static Encoding, evidence: &Evidence, had_errors: bool) -> bool {
    if had_errors {
        return false;
    }
    match evidence.declared {
        Some(named) => named == enc,
        None => enc == EUC_JP && evidence.has_high_bytes,
    }
}

/// 文字として読めたのに棋譜として読めなかった試行
struct Unparsable {
    /// どの文字コードで読めたか。**化けずに読めたが名乗れないときは `None`。**
    ///
    /// 名前を出せないことと、理由（何行目で止まったか）を出せないことは別。
    /// 名前が無くても行番号は利用者の役に立つ。
    encoding: Option<&'static str>,
    /// どこで止まったか
    error: ParseError,
}

/// クレートが見ない文字コードで decode → parse を試す。
///
/// 読めなければ、**誤り無く復号できた試行**の理由を返す。名乗ってよい文字コード
/// （[`can_be_named`]）があればそれを優先し、無ければ名前を伏せて理由だけ返す。
/// 名乗れない候補が複数あるときは、**行数が一番多いもの**（[`line_count`]）。
///
/// 「どの文字コードでも読めなかった」と「4行目が棋譜として読めない」は
/// 利用者にとって別の話で、後者には直す手がある。
fn try_other_encodings<F>(
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

    // 最終手段。**誤りを落として読み進める。**
    //
    // クレートは誤りの1つでもある復号を捨てて `Decode` を返す（`parser::read_kifu` は
    // `!had_errors` のときしか採らない）ので、**Shift_JIS も UTF-8 もここで試し直す**。
    // KIF の既定は Shift_JIS なので、1バイト壊れただけの棋譜がここに来る。
    //
    // TODO(#293): 欠けたことを利用者に告げないまま索引へ入れている
    // 配列リテラルにすると**両方の復号がループに入る前に走る**ので、
    // 1本目で読めたときに使わないコピーを1本作ることになる
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
/// BOM の無い UTF-16 では LE と BE を原理的に区別できないので、
/// ここは当てにいかず先着順にしてある。
///
/// **「改行があること」を通過条件にはしない。** 1行しかない KI2 は正当な入力で、
/// 候補が1つならそれを採る。落とすのは
/// 「他にもっと行数の多い読み方があるとき」だけ。
fn line_count(decoded: &str) -> usize {
    decoded.lines().count()
}

/// 読めなかった理由を利用者に出す文言にする。
///
/// 優先順は次のとおり。**上から順に、より確かなものを採る。**
///
/// 1. `Normalize` — 文字コードと関係が無い（局面に合わない手）。そのまま出す
/// 2. 名乗った文字コードで復号が化けた — バイト列そのものが欠けている印。
///    **クレートが `Kif` を返していても、こちらを先に採る**（下）
/// 3. 総当たりが**名乗れる文字コード**で読んだ理由 — 何行目で止まったかを言う
/// 4. クレートが文字にできていた（`Kif` / `Ki2`）— その理由をそのまま出す
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
fn describe(by_crate: ParseError, evidence: &Evidence, by_fallback: Option<Unparsable>) -> String {
    if let ParseError::Normalize(_) = by_crate {
        return by_crate.to_string();
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
        return format!("{name} としては読めたが、棋譜として読めなかった: {error}");
    }

    match by_crate {
        // クレートが文字にできていた。総当たりの対象は
        // `ENCODINGS_THE_CRATE_SKIPS` の4つだけで、Shift_JIS も UTF-8 もそこに無い。
        // BOM で UTF-8 と分かっていても絞り込む先が無いので、そのまま出す
        ParseError::Kif(_) | ParseError::Ki2(_) => by_crate.to_string(),
        // クレートも文字にできなかった。誤り無く復号できた試行があれば、
        // 名前は伏せて理由だけ使う
        other => match by_fallback {
            Some(Unparsable { error, .. }) => {
                format!("文字コードは特定できませんが、棋譜として読めない箇所があります: {error}")
            }
            None => {
                let tried: Vec<&str> = ENCODINGS_THE_CRATE_TRIES
                    .iter()
                    .copied()
                    .chain(ENCODINGS_THE_CRATE_SKIPS.iter().map(|enc| enc.name()))
                    .collect();
                format!(
                    "{other}: {} のどれでも文字として読めませんでした。\
                         棋譜ではないファイルに棋譜の拡張子が付いていないか確かめてください",
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
    use shogi_kifu_converter_obsshogi::error::{NormalizeError, NormalizeErrorKind};

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
            // どのファイルかは呼び手が `IndexWarnPayload` の別の欄で持つ。
            // ここが言うのは理由
            assert!(
                err.to_string().contains("CSA"),
                "{label}: 何が起きたか言っていない: {err}"
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

    /// [`declared_encoding`] は印だけを見る。**推測しない。**
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
            // NUL は印にしない。混じるだけで UTF-16 と決めると、
            // Shift_JIS の棋譜が UTF-16 として名乗られる
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
                    // `repeat_n` は Rust 1.82 以降。MSRV は 1.77.2（`Cargo.toml`）
                    v.extend(std::iter::repeat(0u8).take(16));
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
            // 実物の KIF は ASCII の見出しから始まる。エスケープは途中に出るので、
            // 先頭だけ見る実装では拾えない
            (
                "ISO-2022-JP のエスケープ（途中）",
                ISO_2022_JP
                    .encode(&format!("#KIF version=2.0\n{kif}"))
                    .0
                    .into_owned(),
                Some(ISO_2022_JP),
            ),
            // `ESC ( B` / `ESC ( J` は ASCII へ戻す指示で、ASCII のファイルにも
            // 現れうる。ISO-2022-JP である証拠にならない
            ("ESC ( B だけ", b"#KIF\x1b(B\n".to_vec(), None),
            ("ESC ( J だけ", b"#KIF\x1b(J\n".to_vec(), None),
            // `ESC $ B` を混ぜると、他の節を消しても通ってしまう
            (
                "ESC $ B だけ",
                b"#KIF\x1b$B\x24\x22\n".to_vec(),
                Some(ISO_2022_JP),
            ),
            // 8bit があっても名乗る。壊れているのは `declared_but_garbled` が拾う
            (
                "ESC $ B があって 8bit も混じる",
                b"#KIF\x1b$B\x24\x22\xFF\n".to_vec(),
                Some(ISO_2022_JP),
            ),
        ];

        for (label, bytes, expected) in cases {
            assert_eq!(
                declared_encoding(&bytes).map(|e| e.name()),
                expected.map(|e| e.name()),
                "{label}"
            );
        }
    }

    /// 名乗ってよい条件。化けていたら名乗らない。ASCII だけなら名乗らない。
    ///
    /// 手掛かりは `Evidence::of` でバイト列から作る。**手で組み立てない** —
    /// [`declared_encoding`] が返さない組（`Some(EUC_JP)` など）を書けてしまい、
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

    /// ASCII だけのファイルを文字コードのせいにしない。
    ///
    /// `.kif` に改名した CSA は EUC-JP としても誤り無く復号できるので、
    /// 「EUC-JP としては読めた」と名乗ると**文字コードを疑わせて遠回りさせる**。
    ///
    /// 出るのはクレートの理由（何行目が読めないか）。
    /// 「拡張子が中身と合っているか」まで案内するかは #327。
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

    /// BOM の無い UTF-16 は、**バイト順を取り違えた読み方の行を出さない。**
    ///
    /// UTF-16 は LE と BE のどちらで読んでも誤りが出ないので、`had_errors` では
    /// 区別が付かない。取り違えると改行が `U+0A00` になって**1行にまとまる**ので、
    /// 候補どうしを行数で比べる（[`line_count`]）。1行しか無い候補も落とさない。
    ///
    /// **LE と BE を対で見る。** 片方だけだと、総当たりの並びで先にあるほうが
    /// たまたま通っているだけかもしれない。
    #[test]
    fn a_bomless_utf16_file_is_not_read_with_the_wrong_byte_order() {
        let dir = temp_dir("bomless-byte-order");
        let text = format!("{}   2 パス\n", hirate_kif());

        for (label, little_endian) in [("le", true), ("be", false)] {
            let path = dir.join(format!("{label}.kif"));
            fs::write(&path, to_utf16(&text, little_endian)).expect("書き出し");

            let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
            let message = err.to_string();
            assert!(
                message.contains("パス"),
                "{label}: バイト順を取り違えた読み方を出している: {message}"
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// BOM の無い UTF-16 でも、**何行目が読めないか**は捨てない。
    ///
    /// 文字コードの名前は出せない（印が無いので特定できない）が、
    /// 誤り無く復号できて棋譜として読めなかったなら、その理由は利用者の役に立つ。
    /// 「棋譜ではないファイルかもしれない」と言うのは、文字にすらできなかったときだけ。
    #[test]
    fn a_bomless_utf16_file_still_reports_the_line() {
        let dir = temp_dir("bomless-utf16");
        let path = dir.join("bomless.kif");
        let text = format!("{}   2 パス\n", hirate_kif());
        fs::write(&path, to_utf16(&text, true)).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("パス"),
            "読めなかった語を捨てている: {message}"
        );
        assert!(
            !message.contains("棋譜ではないファイル"),
            "棋譜なのに棋譜でないと言っている: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 切れた ISO-2022-JP も「切れている」と言う。
    ///
    /// ISO-2022-JP の本文はすべて 0x80 未満なので、クレートの Shift_JIS 復号は
    /// **誤りを出さず `Kif` を返す**。クレートの理由を先に採ると、
    /// 化けた行を「読めない行」として名指しすることになる。
    #[test]
    fn a_truncated_iso2022jp_file_is_reported_as_truncated() {
        let dir = temp_dir("truncated-iso2022");
        let path = dir.join("cut.kif");
        // 末尾を落とすだけではパーサが通してしまうので、読めない語も入れておく
        let text = format!("{}   2 パス\n", hirate_kif());
        let mut bytes = ISO_2022_JP.encode(&text).0.into_owned();
        bytes.truncate(bytes.len() - 2);
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("切れて"),
            "切れていることを言っていない: {message}"
        );
        assert!(
            !message.contains('\u{1b}'),
            "化けた行をそのまま出している: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// 局面に合わない手は、文字コードの話にしない。
    ///
    /// `ParseError::Normalize` は文字コードと関係が無い。
    /// 総当たりの結果で上書きすると、反則手や知らない手合割の棋譜が
    /// 「文字コードが特定できない」と言われる。
    #[test]
    fn a_move_that_does_not_fit_the_position_is_not_blamed_on_the_encoding() {
        // tag に判定したい語を入れないこと。メッセージにはパスも入るので、
        // `contains` がファイル名を拾って素通りする
        let dir = temp_dir("bad-move");
        let path = dir.join("unknown-handicap.kif");
        // クレートの表に無い手合割は平手として素通しされ、上手の初手が指せない
        let text = one_move_kif("九枚落ち");
        let (bytes, _, _) = SHIFT_JIS.encode(&text);
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        assert!(
            message.contains("failed to normalize"),
            "正規化の失敗として出ていない: {message}"
        );
        assert!(
            !message.contains("文字コード"),
            "文字コードの話にすり替わっている: {message}"
        );
        for enc in ENCODINGS_THE_CRATE_SKIPS {
            assert!(
                !message.contains(enc.name()),
                "文字コードのせいにしている（{}）: {message}",
                enc.name()
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 壊れたバイトが混じっていても、落として読み進める。
    ///
    /// **索引に入るかどうかを決める最後の分岐。** これを外すと、
    /// 1バイト壊れただけの棋譜が丸ごと検索から消える。
    ///
    /// **文字コードごとに表で回す。** 1つの題材だけだと、
    /// たまたまその文字コードを拾う経路が生きているだけで緑になる。
    /// KIF の既定は Shift_JIS なので、そこが一番よく通る道 —
    /// 表から Shift_JIS の段を消すと落ちる。
    ///
    /// 欠けたまま索引へ入れていることは #293 で扱う。
    #[test]
    fn a_file_with_one_broken_byte_is_still_read() {
        let dir = temp_dir("lossy");
        let text = format!("*コメント\n{}", hirate_kif());

        for (label, encoded) in [
            ("utf-8", text.clone().into_bytes()),
            ("shift_jis", SHIFT_JIS.encode(&text).0.into_owned()),
            ("euc-jp", EUC_JP.encode(&text).0.into_owned()),
        ] {
            let mut bytes = encoded;
            // コメント行の途中を、どの日本語文字コードでも不正なバイトにする
            let at = bytes.len() / 4;
            bytes[at] = 0xFD;

            let path = dir.join(format!("{label}.kif"));
            fs::write(&path, &bytes).expect("書き出し");

            let jkf = read_path_to_jkf(&path, KifuKind::Kif)
                .unwrap_or_else(|e| panic!("{label} が読めない: {e}"));
            assert_eq!(jkf.moves.len(), 2, "{label} の指し手が落ちた");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 中身の無いファイルは索引に入れない。
    ///
    /// KIF / KI2 のパーサは**平手の初期局面1件**として `Ok` を返す。
    /// 索引に入ると平手の初期局面で検索したときに全部ヒットし、開いても
    /// 初期局面しか出ないので「そういう棋譜」と誤解される。
    ///
    /// **指し手が0手の正当な棋譜と混同しないこと。** 判定は読めた記録が
    /// 何か言っているかで、手数だけでは見ない。
    ///
    /// 題材にいろいろな文字コードを並べてあるのは、**バイト列を先に検査する
    /// 作りに戻ると、ここが落ちる**ようにするため。事前の門はどうしても
    /// 読み手より狭い集合しか見ないので、EUC-JP や BOM 無しの UTF-16 が抜ける。
    #[test]
    fn an_empty_file_is_rejected_but_a_moveless_kifu_is_not() {
        let dir = temp_dir("empty");

        // 「書き出しが途中で終わった跡」の形はいくつもある。
        // バイト数だけ、あるいは生バイトの空白だけを見ると取りこぼす
        let cases: [(&str, Vec<u8>); 20] = [
            ("empty", vec![]),
            ("whitespace", b"\n\n   \n".to_vec()),
            ("utf8-bom-only", vec![0xEF, 0xBB, 0xBF]),
            ("utf16le-bom-only", vec![0xFF, 0xFE]),
            ("utf16be-bom-only", vec![0xFE, 0xFF]),
            // UTF-16LE の改行と空白。NUL が挟まる
            (
                "utf16le-whitespace",
                vec![0xFF, 0xFE, 0x0A, 0x00, 0x20, 0x00],
            ),
            // `str::trim` は Unicode の空白を落とす。バイトの集合で数えると
            // 全角スペース1文字で抜ける
            ("zenkaku-utf8", "　".as_bytes().to_vec()),
            ("zenkaku-utf8-lines", "　　　\n".as_bytes().to_vec()),
            ("zenkaku-sjis", vec![0x81, 0x40]),
            ("zenkaku-sjis-nl", vec![0x81, 0x40, 0x0A]),
            ("bom-then-zenkaku", {
                let mut v = vec![0xEF, 0xBB, 0xBF];
                v.extend("　".as_bytes());
                v
            }),
            ("nbsp-utf8", "\u{00A0}".as_bytes().to_vec()),
            ("utf16le-zenkaku", vec![0xFF, 0xFE, 0x00, 0x30]),
            // ここから下は**事前の門が復号しない文字コード**。
            // クレートも読めないが、総当たりと最終手段が読み通してしまう
            ("eucjp-zenkaku", vec![0xA1, 0xA1]),
            ("iso2022-zenkaku", b"\x1b$B\x21\x21\x1b(B".to_vec()),
            ("bomless-utf16le-space", vec![0x20, 0x00]),
            ("bomless-utf16be-space", vec![0x00, 0x20]),
            (
                "bomless-utf16le-nl-space",
                vec![0x0A, 0x00, 0x20, 0x00, 0x0A, 0x00],
            ),
            ("bomless-utf16le-zenkaku", vec![0x00, 0x30]),
            // 平手は「何も書かなかった」と同じ値になる。区別する意味も無い
            (
                "hirate-only",
                "手合割：平手\n手数----指手---------消費時間--\n"
                    .as_bytes()
                    .to_vec(),
            ),
        ];
        for (label, body) in cases {
            let path = dir.join(format!("{label}.kif"));
            fs::write(&path, &body).expect("書き出し");
            let err = read_path_to_jkf(&path, KifuKind::Kif)
                .err()
                .unwrap_or_else(|| panic!("{label} を弾いていない"));
            assert!(
                err.to_string().contains("中身がありません"),
                "{label} の理由が違う: {err}"
            );
        }

        // 中身のある記録は、指し手が0手でも通る。
        // 「対局前に保存した」棋譜はこの形になる
        let moveless = dir.join("moveless.kif");
        let (bytes, _, _) =
            SHIFT_JIS.encode("先手：山田\n後手：田中\n手数----指手---------消費時間--\n");
        fs::write(&moveless, &bytes).expect("書き出し");
        let jkf = read_path_to_jkf(&moveless, KifuKind::Kif).expect("0手の棋譜は読めること");
        assert_eq!(jkf.moves.len(), 1, "初期局面だけのはず");

        // 盤面や手合割が書いてあれば、それだけで中身がある
        let handicap = dir.join("handicap.kif");
        let (bytes, _, _) = SHIFT_JIS.encode("手合割：香落ち\n");
        fs::write(&handicap, &bytes).expect("書き出し");
        read_path_to_jkf(&handicap, KifuKind::Kif).expect("手合割だけの棋譜は読めること");

        // 最初の局面へのコメントだけでも中身がある
        let note = dir.join("note.kif");
        let (bytes, _, _) = SHIFT_JIS.encode("*この局面から考える\n");
        fs::write(&note, &bytes).expect("書き出し");
        read_path_to_jkf(&note, KifuKind::Kif).expect("コメントだけの棋譜は読めること");

        fs::remove_dir_all(&dir).ok();
    }

    /// 利用者に出す文言は、長さを刈って制御文字を落とす。
    ///
    /// クレートのエラーは読めなかった位置から**行末まで**を引用するので、
    /// 改行を含まない大きなファイルではファイルの中身がそのまま文言になる。
    /// それが `IndexWarnPayload` に載り、webview の state に200件まで溜まる。
    #[test]
    fn a_huge_one_line_file_does_not_put_its_contents_in_the_message() {
        let dir = temp_dir("huge-line");
        let path = dir.join("one-line.kif");
        // 改行が1つも無い大きなファイル。制御文字も混ぜる
        let mut bytes = vec![b'x'; 200_000];
        bytes[10] = 0;
        fs::write(&path, &bytes).expect("書き出し");

        let err = read_path_to_jkf(&path, KifuKind::Kif).expect_err("読めないこと");
        let message = err.to_string();
        // **固定したい定数そのものと比べない。** `MESSAGE_LIMIT` を上げるだけで
        // 通ってしまい、刈り込みが効かなくなったことに気付けない
        assert!(
            message.chars().count() < 1_000,
            "文言が刈られていない: {} 文字",
            message.chars().count()
        );
        assert!(
            !message.contains('\0'),
            "制御文字がそのまま入っている: {message:?}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// `describe` の優先順を直接見る。
    ///
    /// 壊れ方はどれもこの順序で起きる（クレートの一語が総当たりの理由を押しのける /
    /// 化けた復号が正しい行を押しのける / 切れている判定が `Kif` の後ろにあって
    /// 到達しない）。ファイル越しのテストは「その題材が通る腕」しか見ないので、
    /// **上の段と競合させた入力**をここで並べる。
    #[test]
    fn describe_prefers_the_more_certain_reason() {
        let plain = Evidence::of(&SHIFT_JIS.encode(&hirate_kif()).0);
        let mut bom_utf16 = vec![0xFFu8, 0xFE];
        bom_utf16.extend(to_utf16(&hirate_kif(), true));
        let garbled = Evidence::of(&{
            let mut v = bom_utf16.clone();
            v.pop();
            v
        });

        let kif_reason = || ParseError::Kif("at line 9 ONLY-CRATE".to_owned());
        let named = || {
            Some(Unparsable {
                encoding: Some("EUC-JP"),
                error: ParseError::Kif("at line 4 NAMED".to_owned()),
            })
        };
        let anonymous = || {
            Some(Unparsable {
                encoding: None,
                error: ParseError::Kif("at line 5 ANON".to_owned()),
            })
        };

        // 1. Normalize は常に勝つ。文字コードと関係が無い
        let normalize = || {
            ParseError::Normalize(NormalizeError {
                ply: 3,
                kind: NormalizeErrorKind::NoLastMove,
            })
        };
        assert!(describe(normalize(), &garbled, named()).contains("ply 3"));

        // 2. 化けている > クレートの Kif。切れた ISO-2022-JP がここを通る
        let message = describe(kif_reason(), &garbled, None);
        assert!(message.contains("切れて"), "2 が 4 に負けた: {message}");

        // 3. 名乗れる候補 > クレートの Kif
        let message = describe(kif_reason(), &plain, named());
        assert!(message.contains("NAMED"), "3 が 4 に負けた: {message}");

        // 4. クレートの Kif > 名乗れない候補。どの文字コードでも化けずに読めて
        //    しまうので、名乗れない候補を先に採るとクレートの正しい行を押しのける
        let message = describe(kif_reason(), &plain, anonymous());
        assert!(message.contains("ONLY-CRATE"), "5 が 4 に勝った: {message}");

        // 5. クレートが文字にできなければ、名乗れない候補を使う
        let message = describe(ParseError::Decode, &plain, anonymous());
        assert!(message.contains("ANON"), "5 が使われていない: {message}");

        // 6. どれも無ければ試した文字コードを並べる
        let message = describe(ParseError::Decode, &plain, None);
        assert!(
            message.contains("UTF-16LE"),
            "6 が使われていない: {message}"
        );
    }

    /// ファイルを開けなかった理由も日本語で言う。**4形式すべてで。**
    ///
    /// CSA / JKF はクレートが自分でファイルを開くので、
    /// 形式ごとの分岐より前に見ないと `os error 13` が生のまま画面に出る。
    #[test]
    fn a_file_that_cannot_be_opened_says_why_in_every_format() {
        let dir = temp_dir("unreadable");
        let kinds = [
            ("kif", KifuKind::Kif),
            ("ki2", KifuKind::Ki2),
            ("csa", KifuKind::Csa),
            ("jkf", KifuKind::Jkf),
        ];

        for (label, kind) in kinds {
            // 存在しない
            let missing = dir.join(format!("missing.{label}"));
            let err = read_path_to_jkf(&missing, kind)
                .err()
                .unwrap_or_else(|| panic!("{label}: 無いファイルが読めた"));
            assert!(
                err.to_string().contains("無くなりました"),
                "{label}: 無いことを言っていない: {err}"
            );

            // 権限が無い
            let denied = dir.join(format!("denied.{label}"));
            fs::write(&denied, b"x").expect("書き出し");
            let mut perms = fs::metadata(&denied).expect("metadata").permissions();
            std::os::unix::fs::PermissionsExt::set_mode(&mut perms, 0o000);
            fs::set_permissions(&denied, perms).expect("chmod");

            let err = read_path_to_jkf(&denied, kind)
                .err()
                .unwrap_or_else(|| panic!("{label}: 読めない権限で読めた"));
            assert!(
                err.to_string().contains("権限"),
                "{label}: 権限のことを言っていない: {err}"
            );
        }

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
