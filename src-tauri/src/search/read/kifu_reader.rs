//! 棋譜ファイルを1件読んで JKF にする。**どの形式をどう読むかの入口。**

use std::fs;
use std::path::Path;

use encoding_rs::SHIFT_JIS;

use crate::search::read::csa::parse_csa_portable;
use crate::search::read::diagnosis::{cannot_open, parse_failed, unreadable_record};
use crate::search::read::encoding::{read_bytes, read_portable, ENCODINGS_THE_CRATE_SKIPS};
use crate::search::read::fs_scan::{FileRecord, KifuKind};
use crate::search::read::outcome::{Jkf, KifuReadError, ReadOutcome};

use shogi_kifu_converter_obsshogi::parser::{
    parse_jkf_file, parse_ki2_file, parse_ki2_str, parse_kif_file, parse_kif_str,
};

/// 走査で見つけたファイルを読む。**索引を作る経路はこちらを呼ぶ。**
///
/// # 形式ごとに手当てが違う
///
/// | 形式 | 文字コードの総当たり | 読み残し | 画面との食い違い |
/// | --- | --- | --- | --- |
/// | KIF / KI2 | する（`read_portable`） | クレートが断る | — |
/// | CSA | する（`read_portable_bytes`） | クレートが断る | **画面が開けない形を先に断る**（`parse_csa_portable`） |
/// | JKF | しない（JSON なので UTF-8） | — | — |
///
/// 非対称の理由は `parse_csa_portable` の doc にある。
/// 形式を問わない経路（開けない・`SIZE_LIMIT` 超過）は形式で分岐する前にあり、
/// この表の外。
///
/// # 戻り
///
/// 3つある。**どれを返すかで、呼び手のすることが変わる。**
///
/// | 戻り | 何が起きたか | 呼び手のすること |
/// | --- | --- | --- |
/// | `Ok(`[`ReadOutcome::Indexable`]`)` | 読めた | 局面を索引に入れる。`warns` があれば出す |
/// | `Ok(`[`ReadOutcome::NothingToIndex`]`)` | 読めたが入れる局面が無い | **項目だけ登録する。** `warns` があれば出す |
/// | `Err(`[`KifuReadError::ParseFailed`]`)` | 読めなかった | 文言を警告として出す |
///
/// **項目の登録は3つとも同じ。** 全件構築（`build.rs`）も差分更新
/// （`project_manager.rs`）も項目を登録する —— 登録しないと `file_table` の
/// 世代が上がらず、**前の世代のセグメントが索引に残る**。
/// 下2つでは、その棋譜の局面は検索に出てこない。
///
/// 今の読み手は `warns` を積まない（読み残しはクレートが `Err` で断る）。
/// `NothingToIndex` を `looks_intentional` で割った表は `docs/state-transitions/search.md`
/// （この関数を主語にしている）。
///
/// [`ReadOutcome::Indexable`]: crate::search::read::outcome::ReadOutcome::Indexable
/// [`ReadOutcome::NothingToIndex`]: crate::search::read::outcome::ReadOutcome::NothingToIndex
/// [`KifuReadError::ParseFailed`]: crate::search::read::outcome::KifuReadError::ParseFailed
pub fn read_to_jkf(rec: &FileRecord) -> Result<ReadOutcome, KifuReadError> {
    read_path_inner(&rec.path, rec.kind)
}

/// 読めた記録に、索引へ入れる局面が無いか。
///
/// **パーサは中身の無いファイルを「平手の初期局面1件」として `Ok` で返す。**
/// そのまま索引に入れると平手の初期局面で検索したときに全部ヒットし、開いても
/// 初期局面しか出ないので「そういう棋譜」と誤解される。だから入れない。
///
/// **これは「壊れている」の判定ではない。** `ReadOutcome::NothingToIndex`
/// の doc のとおり、同じ形になるものにはこのアプリが作った新しい棋譜も含まれる。
///
/// # バイト列でなく、読めた記録の形で決める
///
/// **バイト列を先に検査すると、検査した文字コードの集合と、
/// あとで実際に読み通す集合とがずれる。** 読み手が通すのは
/// クレートの2つ・[`ENCODINGS_THE_CRATE_SKIPS`] の4つ・[`LOSSY_DECODERS`] の2つで、
/// 事前の判定でそれを再現しようとすると、復号を1つ足すたびに片方だけ増えて穴が空く。
/// 判定する場所を「読み通したあと」に置けば、集合はそもそも1つしかない。
///
/// # 見る欄は [`index_builder`] が歩く欄と揃える
///
/// **どちらかが広いと索引が狂う。** 狭すぎれば局面を持つ記録を落とし、
/// 広すぎれば局面を1つも持たない記録を通して**平手の初期局面だけを索引に入れる**
/// （この判定が防ぐはずの当のもの）。1つでも埋まっていれば通す。
///
/// | 欄 | 埋まる例 |
/// | --- | --- |
/// | 指し手が2件以上 | 1手でも指されていれば `moves` は初期局面ぶんと合わせて2件。`投了` だけの記録もこれ |
/// | ヘッダ | `先手：` `棋戦：` などが1つでもある |
/// | 初期局面 | 盤面が書いてある（詰将棋・局面図）、平手以外の手合割 |
/// | 最初の局面の注釈 | `*` のコメントだけの棋譜（KIF / KI2 でも届く） |
/// | 最初の局面の終局 | 手で組んだ `.jkf` だけ |
///
/// 最後の欄に届くのが `.jkf` だけなのは、**3形式とも終局を初期局面より後ろに積む**から。
/// KIF / KI2 は番号付きの手順行からしか作らず、CSA は番号を持たないが
/// クレートが `moves` を既定値1件から始めて以降を `push` する（`csa.rs`）。
/// そちらは指し手が2件以上になるので1行目で通る。
/// 注釈（`*`）は手順行を要らないので、KIF / KI2 でもこの欄に届く。
///
/// # `moves[0].forks` は数に入れない
///
/// **[`crate::search::index::index_builder`] がその欄を歩かない。** `forks` を読むのは
/// `walk_sequence` の中だけで、そこへ渡るのは `moves[1..]`。
/// `moves[0]` の変化は誰も見ない。
///
/// ここで数えると、その記録は登録されるのに**入る局面は平手の初期局面1件だけ**になる。
/// 歩く側を広げないのは、`moves[0]` に指し手が無いので**その変化が「何の代わり」なのかが
/// 決まらない**ため。再生器も同じ理由でそこへ入れない。
///
/// 変化を持つ普通の棋譜は `moves[1]` 以降に付くので、指し手が2件以上になって1行目で通る。
///
/// **`手合割：平手` だけの記録は、何も書かなかったものと区別できない** —
/// 平手の初期局面は既定値と同じになる。どちらも入れる局面が無いので区別しない。
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
        .is_none_or(|m| m.comments.is_none() && m.special.is_none())
}

/// これを超えるファイルは棋譜として読まない。
///
/// **読めないファイルほど高くつく。** 読み通せなかった KIF / KI2 / CSA は、
/// クレート・[`read_bytes`]・[`ENCODINGS_THE_CRATE_SKIPS`] の4つ・
/// [`LOSSY_DECODERS`] の2つで同じ中身を何度も持つ。実測で 50MB の
/// 1行ファイル1つが 3.3 秒・常駐 500MB（クレート単体の 6.6 倍）。
/// 索引作りは最大8本並列なので、`.kif` に改名した動画や zip が数本混ざると
/// その間だけ数 GB 持っていかれる。
///
/// 8 MiB は、609件のコーパスで一番大きい棋譜（分岐の多い研究ファイル・669 KB）の
/// 12 倍。**上限に当たる棋譜が実在するなら、それは上げる理由になる** —
/// 文言がサイズを言うのはそのため。
const SIZE_LIMIT: u64 = 8 * 1024 * 1024;

/// 境界を1箇所に置く。**上限ちょうどは読む。**
///
/// 通し経路のテストで境界を見ようとすると、8 MiB の棋譜を実際に読ませることになり
/// テスト1本で6秒かかる。判断はここだけなので、ここを直に見れば足りる。
fn too_large_to_be_a_kifu(len: u64) -> bool {
    len > SIZE_LIMIT
}

/// **`warns` を捨てる。** 索引を作る経路は [`read_to_jkf`] を通ること。
///
/// 公開していないのは、**捨ててよい呼び手が本番に1つも無い**から。
/// 題材を1本ずつ確かめるテストのために残してある。
#[cfg(test)]
fn read_path_to_jkf(path: &Path, kind: KifuKind) -> Result<Jkf, KifuReadError> {
    match read_path_inner(path, kind)? {
        ReadOutcome::Indexable { jkf, .. } => Ok(*jkf),
        // **`Err` に混ぜない。** 混ぜると「読めなかった」と区別が付かなくなり、
        // 題材が空になったテストが「読めない」の assert で緑のまま通る。
        // 空になりうる題材は `read_path_inner` で受けること
        ReadOutcome::NothingToIndex { warns, .. } => panic!(
            "題材に索引へ入れる局面が無い。`read_path_inner` で受けること（warns: {warns:?}）"
        ),
    }
}

/// **索引に入る題材**を、記録と警告の組で受ける。
///
/// 入る局面が無い題材は `read_path_inner` で受けること。ここへ流すと落ちる —
/// 組で受けられるようにすると、題材が空になったテストが
/// **警告の assert を素通りして緑のまま**になる。
#[cfg(test)]
fn read_indexable(
    path: &Path,
    kind: KifuKind,
) -> Result<(Jkf, Vec<crate::search::message::ScreenMessage>), KifuReadError> {
    match read_path_inner(path, kind)? {
        ReadOutcome::Indexable { jkf, warns } => Ok((*jkf, warns)),
        ReadOutcome::NothingToIndex { warns, .. } => panic!(
            "題材に索引へ入れる局面が無い。`read_path_inner` で受けること（warns: {warns:?}）"
        ),
    }
}

/// **中身が無いか。** 空白しか無いファイルを「本当に空の棋譜」から外す。
///
/// 同期の途中で置かれたプレースホルダや、保存が落ちた残骸がこの形になる。
/// 大きさ0だけを見ると、改行1つや BOM だけのものが素通りする——どれも
/// 「空なのが正しい姿」ではない。
///
/// **復号してから見る。** 生バイトの ASCII 空白だけを数えると、全角スペース・
/// NBSP・EUC-JP・ISO-2022-JP・BOM 無しの UTF-16 が全部抜ける
/// （`an_empty_file_is_rejected_but_a_moveless_kifu_is_not` が20形を並べている）。
/// 文字コードが分からないので**候補を総当たりし、どれか1つでも空白だけに
/// 読めたら空**とする——「空に読める読み方がある」なら、その棋譜から
/// 索引に入るものは無い。
///
/// `char::is_whitespace` は全角スペースも NBSP も落とす。BOM は
/// 空白ではないので明示的に外す。
fn is_blank(bytes: &[u8]) -> bool {
    let blank = |s: &str| {
        s.chars()
            .all(|c| c.is_whitespace() || c == '\u{feff}' || c == '\0')
    };

    if blank(&String::from_utf8_lossy(bytes)) {
        return true;
    }
    ENCODINGS_THE_CRATE_SKIPS
        .iter()
        .chain(std::iter::once(&SHIFT_JIS))
        .any(|enc| blank(&enc.decode(bytes).0))
}

/// 棋譜ファイルを JKF に読み、伝えたいことも返す。**読み手の本体。**
///
/// 表と腕ごとの義務は [`read_to_jkf`] の doc にある。
fn read_path_inner(path: &Path, kind: KifuKind) -> Result<ReadOutcome, KifuReadError> {
    // ファイルそのものを開けるかを、形式ごとの分岐より前に1度だけ見る。
    // CSA / JKF はクレートが自分で開くので、ここを通さないと
    // `Permission denied (os error 13)` が生のまま画面に出る
    let file = fs::File::open(path).map_err(cannot_open)?;

    // 大きさは開いた手で見る。`fs::metadata` を別に呼ぶと、
    // 見た対象と読む対象がずれる
    if let Ok(meta) = file.metadata() {
        if too_large_to_be_a_kifu(meta.len()) {
            // **上限値そのものを言う。** 「大きすぎる」だけだと、
            // 上限を上げるべき棋譜が実在したときに報告のしようがない。
            // 切り上げるのは、上限直上のファイルが「上限ちょうど」に見えないため
            return Err(parse_failed(format!(
                "棋譜として読むには大きすぎます（{} MiB。上限は {} MiB）。\
                 棋譜ではないファイルに棋譜の拡張子が付いていないか確認してください",
                meta.len().div_ceil(1024 * 1024),
                SIZE_LIMIT / (1024 * 1024),
            )));
        }
    }

    // **CSA だけバイト列を手元に残す。** 空かどうかの判定が、パースしたのと
    // 同じバイト列を見る。path を渡して別々に読ませると、
    // 「同じものを見ているか」を型で表せない
    let (jkf, csa_bytes) = match kind {
        KifuKind::Kif => (parse_kif_portable(path)?, None),
        KifuKind::Ki2 => (parse_ki2_portable(path)?, None),
        KifuKind::Csa => {
            let bytes = read_bytes(path)?;
            (parse_csa_portable(&bytes)?, Some(bytes))
        }
        KifuKind::Jkf => (
            parse_jkf_file(path).map_err(|e| parse_failed(unreadable_record(e)))?,
            None,
        ),
    };

    // **ここで再導出しない。** `preset` と `initial.data` を見ているのは
    // [`says_nothing`] だけで、ここに条件を写すと片方だけが増えたときに穴が空く。
    // 読み残しはクレートが断るので、ここまで来た記録は最後まで読めている。
    let warns = Vec::new();

    if says_nothing(&jkf) {
        // **空なのが正しい姿か**を、ここで決めて運ぶ。呼び手が `warns` の
        // 有無から導くと、読み手は警告を積まないので必ず「正しい姿」になる
        //
        // **中身を読んで決める。** ここへ来るのは記録が空に見えた回だけなので、
        // 読み直しの費用は掛かっても構わない（`SIZE_LIMIT` で上限は付いている）。
        // 大きさ0だけを見ると、改行1つや BOM だけのファイルが素通りする。
        //
        // **読み直しに失敗した回は「中身が無い」側へ倒す。** パースは通って
        // いても索引済みには数えない——安全側だが、その棋譜がある限り
        // ワークスペースは黄色いままになる
        let has_content = match csa_bytes.as_deref() {
            // **CSA は手元のバイト列を使う。** 読み直すと「パースしたのと
            // 同じものを見ているか」が型で表せなくなるうえ、判定のためだけに
            // 最大 `SIZE_LIMIT` の複製が走る
            Some(b) => !is_blank(b),
            None => match read_bytes(path) {
                Ok(b) => !is_blank(&b),
                // **読み直せないなら「空なのが正しい姿」とは言えない。**
                // 理由は残す——数だけ減って手掛かりが無いと、利用者は
                // なぜ黄色いのかを知りようがない
                Err(e) => {
                    log::warn!("{}: 中身を確かめられなかった: {e}", path.display());
                    false
                }
            },
        };
        let looks_intentional = has_content;
        return Ok(ReadOutcome::NothingToIndex {
            warns,
            looks_intentional,
        });
    }

    Ok(ReadOutcome::Indexable {
        jkf: Box::new(jkf),
        warns,
    })
}

// -------------------------------------
// Portable parsers (KIF / KI2 / CSA)
// -------------------------------------

// `parse_*_file` は `P: AsRef<Path>` で総称化されているので、そのまま渡すと
// 高階の寿命を満たさない。閉包で `&Path` に固定する
fn parse_kif_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    read_portable(path, |p| parse_kif_file(p), parse_kif_str)
}

fn parse_ki2_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    read_portable(path, |p| parse_ki2_file(p), parse_ki2_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::message::SCREEN_MESSAGE_LIMIT;
    use crate::search::read::csa::viewer_refuses;
    use crate::search::read::encoding::{
        can_be_named, describe, Evidence, Unparsable, ENCODINGS_THE_CRATE_SKIPS,
    };
    use encoding_rs::Encoding;
    use encoding_rs::{EUC_JP, ISO_2022_JP, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8};
    use kifu_text::declared_encoding;
    use shogi_kifu_converter_obsshogi::error::ParseError;
    use shogi_kifu_converter_obsshogi::error::{NormalizeError, NormalizeErrorKind};
    use shogi_kifu_converter_obsshogi::jkf::{Initial, MoveFormat, MoveSpecial, Preset};
    use test_support::dir::temp_dir;
    use test_support::kifu::{one_move_kif, HANDICAPS};

    fn hirate_kif() -> String {
        one_move_kif("平手")
    }

    /// 拡張子が名乗る文字コードと中身が食い違うファイルを読む。
    ///
    /// クレートは拡張子の文字コードと Shift_JIS / UTF-8 のもう一方しか試さない。
    /// **`try_other_encodings` が要る根拠そのものをここで確かめる** — 各文字コードで
    /// クレート単体が失敗することを先に見てから、こちらが読めることを見る。
    /// クレートが将来この4つを自前で扱うようになれば前半が落ち、
    /// 総当たりをやめてよいことがここで分かる。
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
                "{label} をクレート単体が読めてしまう。総当たりをやめられるか確かめること"
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
    /// クレートが返す `ParseError::Decode` の Display は `decode error` の一語しかない。
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
        // **案内が先頭にある。** 引用を先に置くと、`parse_failed` の刈り直しで
        // 案内が丸ごと落ちる（`unreadable_record` の doc の語順の規約）。
        // 長さではなく語順を見るので、引用が短い今日でも変異を捕まえられる
        assert!(
            !message.to_lowercase().starts_with("decode error"),
            "クレートの英語が文頭に出ている: {message}"
        );
        assert!(
            message.contains("棋譜ではないファイルに"),
            "案内が刈られて消えた: {message}"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// CSA は壊れた値でパニックせず、読めない値はエラーを返す。
    ///
    /// 消費時間の桁あふれはエラーにする。存在しない日付はヘッダの文字列
    /// として書かれたまま残し、対局は読む（日付は棋譜の局面に関わらない）。
    #[test]
    fn a_csa_with_broken_values_is_an_error_not_a_panic() {
        let dir = temp_dir("csa");

        let path = dir.join("桁あふれの消費時間.csa");
        fs::write(
            &path,
            "V2.2\nPI\n+\n+7776FU\nT99999999999999999999\n%TORYO\n",
        )
        .expect("書き出し");
        let err = read_path_to_jkf(&path, KifuKind::Csa)
            .err()
            .unwrap_or_else(|| panic!("桁あふれの消費時間: 読めてしまった"));
        // どのファイルかは呼び手が `IndexWarnPayload` の別の欄で持つ。
        // ここが言うのは理由
        assert!(
            err.to_string().contains("CSA"),
            "何が起きたか言っていない: {err}"
        );

        let path = dir.join("存在しない日付.csa");
        fs::write(
            &path,
            "V2.2\n$START_TIME:2004/02/30 10:30:00\nPI\n+\n+7776FU\n%TORYO\n",
        )
        .expect("書き出し");
        let jkf = read_path_to_jkf(&path, KifuKind::Csa).expect("日付が壊れていても対局は読める");
        assert_eq!(
            jkf.header.get("開始日時").map(String::as_str),
            Some("2004/02/30 10:30:00"),
            "書かれた日付を残していない"
        );

        // 壊れていない CSA は読める。上のテストだけだと、CSA を常に失敗させても通る
        let ok_path = dir.join("ok.csa");
        fs::write(&ok_path, "V2.2\nPI\n+\n+7776FU\n%TORYO\n").expect("書き出し");
        let jkf = read_path_to_jkf(&ok_path, KifuKind::Csa).expect("正常な CSA が読めること");
        assert_eq!(jkf.moves.len(), 3, "指し手数");

        fs::remove_dir_all(&dir).ok();
    }

    /// 文字としては読めたのに棋譜として読めなかったなら、その理由を出す。
    ///
    /// EUC-JP の棋譜に読めない行が1つあると、クレートは `decode error` を返す
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

    /// [`declared_encoding`] は名乗り（BOM やエスケープ）だけを見る。**推測しない。**
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
            // NUL は名乗りにしない。混じるだけで UTF-16 と決めると、
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
        // 名乗りは BOM で付ける。BOM の無い UTF-16 は名乗らない
        let mut utf16 = vec![0xFF, 0xFE];
        utf16.extend(to_utf16(&hirate_kif(), true));

        // 名乗りが無いとき名乗ってよいのは EUC-JP だけ
        let plain = Evidence::of(&japanese);
        assert!(can_be_named(EUC_JP, &plain, false));
        assert!(!can_be_named(UTF_16LE, &plain, false));
        assert!(!can_be_named(ISO_2022_JP, &plain, false));

        // 8bit の文字が無いなら、どの日本語文字コードの証拠でもない
        assert!(!can_be_named(EUC_JP, &Evidence::of(&ascii), false));

        // 名乗りがあっても、復号で化けていれば名乗らない
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
    /// 名乗った文字コードで復号できたが化けた、は**バイト列が欠けている兆候**。
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
    /// UTF-16 は LE と BE のどちらで読んでもほとんど誤りが出ないので、
    /// `had_errors` では当てにできない（[`line_count`] の doc）。
    /// 取り違えると改行が `U+0A00` になって**1行にまとまる**ので、
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
    /// 文字コードの名前は出せない（名乗りが無いので特定できない）が、
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
        // **文字コードを名乗れなくても、次に何をすればよいかは言う。**
        // この腕はクレートの理由でなく総当たりの理由を使うので、
        // `unreadable_record` を通らない。案内を入れ忘れやすい
        assert!(
            message.contains("その行を直すか"),
            "次に何をすればよいかを言っていない: {message}"
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
        // クレートの本文（何手目・どの升）は捨てない
        assert!(
            message.contains("ply") || message.contains("手目"),
            "何手目かが消えている: {message}"
        );
        // **そのうえで、次に何をすればよいかを言う。** クレートの文言だけを
        // そのまま出すと、利用者に届くのは `failed to normalize` という関数名になる
        assert!(
            message.contains("局面に合いません"),
            "利用者の言葉になっていない: {message}"
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
    /// 表から Shift_JIS の行を消すと落ちる。
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

    /// 中身の無いファイルは索引に入れない。**警告も出さない。**
    ///
    /// KIF / KI2 のパーサは**平手の初期局面1件**として `Ok` を返す。
    /// そのまま索引に入れると平手の初期局面で検索したときに全部ヒットし、
    /// 開いても初期局面しか出ないので「そういう棋譜」と誤解される。
    ///
    /// **指し手が0手の正当な棋譜と混同しないこと。** 判定は読めた記録に
    /// 索引へ入れる局面があるかで、手数だけでは見ない。
    ///
    /// 題材にいろいろな文字コードを並べてあるのは、**バイト列を先に検査する
    /// 作りに戻ると、ここが落ちる**ようにするため。読み通す前に判定すると
    /// 読み手より狭い集合しか見られず、EUC-JP や BOM 無しの UTF-16 が抜ける。
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
            // ここから下は**クレートが試さない文字コード**。
            // 総当たりと [`LOSSY_DECODERS`] が読み通すので、
            // 読み通す前に判定する作りだとここが素通りする
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
            let outcome = read_path_inner(&path, KifuKind::Kif)
                .unwrap_or_else(|e| panic!("{label} が読めなかった扱いになっている: {e}"));
            // **黙って弾くこと。** `{ .. }` で受けると警告が付いても緑になる
            let ReadOutcome::NothingToIndex {
                warns,
                looks_intentional,
            } = outcome
            else {
                panic!("{label} を弾いていない");
            };
            assert!(
                warns.is_empty(),
                "{label} が警告つきで弾かれている: {warns:?}"
            );
            // **「空なのが正しい姿」かも見る。** ここを `..` で受けている限り、
            // 20形をいくら並べても `looks_intentional` は誰も見ていない
            // ——`indexed` に化けて緑の「準備完了」になる
            let intentional_by_design = label == "hirate-only";
            assert_eq!(
                looks_intentional, intentional_by_design,
                "{label} の「空なのが正しい姿か」が違う"
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

        // 盤面だけの棋譜（詰将棋・局面図）
        let mate = dir.join("mate.kif");
        let (bytes, _, _) = SHIFT_JIS.encode(BOARD_ONLY_KIF);
        fs::write(&mate, &bytes).expect("書き出し");
        let board = read_path_to_jkf(&mate, KifuKind::Kif).expect("盤面だけの棋譜は読めること");
        assert!(
            board.initial.as_ref().is_some_and(|i| i.data.is_some()),
            "盤面が読めていない題材になっている"
        );

        // **`initial.data` の欄を見る唯一の題材。**
        // 手合割つきの棋譜は `preset` が `PresetOther` になるので手前の条件で通る。
        // `preset` が平手のまま盤面を持てるのは手で組んだ `.jkf` だけで、
        // `initial_position.rs` が「盤面が preset に勝つ」と決めているのはこの形。
        // これが無いと `initial.data.is_some()` を落とす変更が全件緑のまま通る
        let mut board_under_hirate = board;
        board_under_hirate.initial = board_under_hirate.initial.map(|i| Initial {
            preset: Preset::PresetHirate,
            data: i.data,
        });
        board_under_hirate.header.clear();
        let path = dir.join("board-under-hirate.jkf");
        fs::write(
            &path,
            serde_json::to_string(&board_under_hirate).expect("JKF に綴れること"),
        )
        .expect("書き出し");
        read_path_to_jkf(&path, KifuKind::Jkf).expect("盤面を持つ .jkf を落としている");

        // 手で組んだ `.jkf` だけが届く2つの欄。KIF / KI2 / CSA のパーサは
        // 終局も分岐も**番号付きの手順行から**しか作らないので、
        // そちらは手数（`moves.len() > 1`）のほうで通る。
        // この2件が無いと、対応する条件を落とす変更が全件緑のまま通る
        let one_move = parse_kif_str(&one_move_kif("平手")).expect("題材の KIF が読めること");

        let special_only = Jkf {
            moves: vec![MoveFormat {
                special: Some(MoveSpecial::SpecialToryo),
                ..MoveFormat::default()
            }],
            ..Jkf::default()
        };

        let path = dir.join("special-only.jkf");
        fs::write(
            &path,
            serde_json::to_string(&special_only).expect("JKF に綴れること"),
        )
        .expect("書き出し");
        read_path_to_jkf(&path, KifuKind::Jkf).expect("special-only を落としている");

        // **`moves[0].forks` は中身があっても数えない。** `index_builder` は
        // `moves[1..]` しか歩かないので、数えると登録されるのに入る局面は
        // 平手の初期局面1件だけになる（この判定が防ぐはずの当のもの）。
        // 中身の有無で割れないことを、両方置いて見る
        for (label, forks) in [
            (
                "fork-line-with-a-move",
                vec![vec![one_move.moves[1].clone()]],
            ),
            ("empty-fork-line", vec![vec![]]),
        ] {
            let jkf = Jkf {
                moves: vec![MoveFormat {
                    forks: Some(forks),
                    ..MoveFormat::default()
                }],
                ..Jkf::default()
            };
            let path = dir.join(format!("{label}.jkf"));
            fs::write(
                &path,
                serde_json::to_string(&jkf).expect("JKF に綴れること"),
            )
            .expect("書き出し");
            let Ok(ReadOutcome::NothingToIndex { .. }) = read_path_inner(&path, KifuKind::Jkf)
            else {
                panic!("{label}: 誰も歩かない変化を索引に入れている");
            };

            // **「誰も歩かない」を組み立ての側からも見る。** ここを見ないと、
            // `walk_sequence` が `moves[0].forks` を降りるようになっても
            // 上の assert は緑のままで、**この判定が索引の穴になる**。
            // 逆に狭めれば `says_nothing` が通した記録が初期局面1件だけになる
            let built = crate::search::index::index_builder::build_index_for_jkf(
                1,
                1,
                &jkf,
                crate::search::index::index_builder::BuildPolicy::Loose,
            )
            .expect("組めること");
            assert_eq!(
                built.node_table.nodes.len(),
                1,
                "{label}: `moves[0].forks` を歩く側が増えている。\
                 `says_nothing` の見る欄も一緒に広げること"
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 盤面だけを書いた KIF。列の見出しは**先頭2文字ぶん空ける**
    /// （クレートの `board_row` がそう読む）。
    const BOARD_ONLY_KIF: &str = "後手の持駒：なし
  ９ ８ ７ ６ ５ ４ ３ ２ １
+---------------------------+
| ・ ・ ・ ・v玉 ・ ・ ・ ・|一
| ・ ・ ・ ・ ・ ・ ・ ・ ・|二
| ・ ・ ・ ・ ・ ・ ・ ・ ・|三
| ・ ・ ・ ・ ・ ・ ・ ・ ・|四
| ・ ・ ・ ・ ・ ・ ・ ・ ・|五
| ・ ・ ・ ・ ・ ・ ・ ・ ・|六
| ・ ・ ・ ・ ・ ・ ・ ・ ・|七
| ・ ・ ・ ・ ・ ・ ・ ・ ・|八
| ・ ・ ・ ・ 玉 ・ ・ ・ ・|九
+---------------------------+
先手の持駒：金二
";

    /// **このアプリが作った棋譜を、このアプリが「壊れている」と言わない。**
    ///
    /// 新規作成フォームはファイル名以外すべて任意なので、対局者名を入れずに
    /// 作れる。そのとき綴られるのは「平手の初期局面だけ」で、
    /// `says_nothing` に当たる形そのもの。
    ///
    /// これを `ParseFailed` にすると、**利用者が作った直後のファイルについて
    /// アプリが「保存が途中で終わっていないか」と警告する**。保存は終わっている。
    /// 索引に入れる局面が無いことと、ファイルが壊れていることは別。
    ///
    /// **見ているのは綴りの段階（`spell_for_extension`）だけ。**
    /// `create_kifu_file` はその手前で `normalize()` を通すので、
    /// そちらが空の JKF に何かを足すよう変われば、このテストは緑のまま素通りする。
    #[test]
    fn a_kifu_this_app_just_created_is_never_called_broken() {
        use crate::workspace::record::spell_for_extension as spell;

        let dir = temp_dir("just-created");

        // `createInitialJKFData` が何も入力しなかったときに組むもの
        let blank = Jkf {
            initial: Some(Initial {
                preset: Preset::PresetHirate,
                data: None,
            }),
            moves: vec![MoveFormat::default()],
            ..Jkf::default()
        };

        for (ext, kind) in [
            ("kif", KifuKind::Kif),
            ("ki2", KifuKind::Ki2),
            ("csa", KifuKind::Csa),
            ("jkf", KifuKind::Jkf),
        ] {
            let path = dir.join(format!("新規.{ext}"));
            // **4形式とも綴れる。** 綴れなくなったら気付きたいので、
            // 飛ばさずに落とす。`Err` になるのは拡張子が対象外のときだけ
            let content = spell(&blank, &path)
                .unwrap_or_else(|e| panic!("{ext}: 新規作成の既定を綴れない: {e:?}"));
            assert!(!content.is_empty(), "{ext}: 0バイトのファイルを作っている");
            fs::write(&path, &content).expect("書き出し");

            // **警告も出させない。** 出しても利用者に直しようが無い。
            // `{ .. }` で受けると `warn` が付いても緑になるので、中身まで見る
            match read_path_inner(&path, kind) {
                // 入れる局面があるかは形式で変わるが、**どちらでも警告は出させない**
                Ok(
                    ReadOutcome::Indexable { warns, .. }
                    | ReadOutcome::NothingToIndex { warns, .. },
                ) => {
                    assert!(
                        warns.is_empty(),
                        "{ext}: 直しようの無い警告が出た: {warns:?}"
                    );
                }
                Err(e) => panic!("{ext}: 作ったばかりの棋譜を壊れていると言っている: {e}"),
            }
        }

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
        // **固定したい定数そのものと比べない。** `SCREEN_MESSAGE_LIMIT` を上げるだけで
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
    /// **優先順で上にあるものと競合させた入力**をここで並べる。
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

            // 権限が無い。**モードの立て方が OS ごとに違う**ので unix だけ
            #[cfg(unix)]
            {
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
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 大きすぎるファイルは、読もうとする前に断る。
    ///
    /// 読めないファイルほど高くつく（同じ中身を復号ごとに持つ）。
    /// 索引作りは最大8本並列なので、`.kif` に改名した動画や zip が数本あると
    /// その間だけ数 GB 持っていかれる。
    ///
    /// **中身は棋譜として正しくても断る。** 大きさだけで決めるので、
    /// 上限に当たる棋譜が実在するなら上限を上げる話になる。
    #[test]
    fn a_file_too_large_to_be_a_kifu_is_refused_before_it_is_read() {
        let dir = temp_dir("too-large");

        let path = dir.join("huge.kif");
        let mut body = hirate_kif().into_bytes();
        body.resize(SIZE_LIMIT as usize + 1, b' ');
        fs::write(&path, &body).expect("書き出し");

        let Err(err) = read_path_to_jkf(&path, KifuKind::Kif) else {
            panic!("上限を超えたファイルを読んでしまった");
        };
        assert!(
            err.to_string().contains("大きすぎます"),
            "理由が大きさでない: {err}"
        );

        // 境界。1つずれると、上限ちょうどの棋譜が読めなくなる
        assert!(!too_large_to_be_a_kifu(SIZE_LIMIT), "上限ちょうどを断った");
        assert!(
            too_large_to_be_a_kifu(SIZE_LIMIT + 1),
            "上限の1つ上を通した"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Shift_JIS の CSA が読める。
    ///
    /// **ShogiGUI / Shogidokoro が書き出す CSA は Shift_JIS が普通**なので、
    /// これが読めないと同じ対局が KIF なら索引に入って CSA なら入らない。
    /// クレートは拡張子を見ず、バイト列で UTF-8 → Shift_JIS の順に決める。
    #[test]
    fn a_shift_jis_csa_is_read() {
        let dir = temp_dir("sjis-csa");
        let path = dir.join("対局.csa");
        let (bytes, _, _) = SHIFT_JIS.encode("V2.2\nN+山田太郎\nPI\n+\n+7776FU\n");
        fs::write(&path, &bytes).expect("書き出し");

        let jkf = read_path_to_jkf(&path, KifuKind::Csa).expect("Shift_JIS の CSA が読めること");
        assert!(
            jkf.header.values().any(|v| v == "山田太郎"),
            "Shift_JIS の対局者名が化けている: {:?}",
            jkf.header
        );
        assert_eq!(jkf.moves.len(), 2, "指し手が読めていない");

        fs::remove_dir_all(&dir).ok();
    }

    /// CSA も、クレートが試さない文字コードで読める。
    ///
    /// CSA は KIF / KI2 と同じ [`read_portable`] を通る。通らないと、
    /// **同じ対局が KIF なら索引に入って CSA なら入らない**（#325）。
    ///
    /// ISO-2022-JP を並べていないのは、そこに届かないから — 7bit なので
    /// クレートの UTF-8 復号が誤り無く通り、CSA の指し手行は ASCII なので
    /// そのまま `Ok` になる。[`read_portable`] の doc にある。
    ///
    /// **EUC-JP は本文しだいで届かない。** 題材に名前を2つと棋戦名を置いてあるのは、
    /// 短い本文だと EUC-JP のバイト列が丸ごと Shift_JIS の半角カナとして
    /// 誤り無く復号できてしまい、クレートが化けたまま `Ok` を返すため
    /// （`N+山田太郎` だけだと `ｻｳﾅﾄﾂﾀﾏｺ` になる）。ここで固定するのは
    /// **総当たりに届いた場合に読めること**で、届くこと自体ではない。
    #[test]
    fn a_csa_is_read_in_the_encodings_the_crate_skips() {
        let dir = temp_dir("csa-encodings");
        let body = "V2.2\nN+山田太郎\nN-田中一郎\n$EVENT:研究会\nPI\n+\n+7776FU\n";

        // BOM の無い UTF-16 は `encoding_rs` では綴れないので手で組む
        let utf16 = |big: bool| -> Vec<u8> {
            body.encode_utf16()
                .flat_map(|u| {
                    let [a, b] = if big {
                        u.to_be_bytes()
                    } else {
                        u.to_le_bytes()
                    };
                    [a, b]
                })
                .collect()
        };

        let cases: [(&str, Vec<u8>); 3] = [
            ("euc-jp", EUC_JP.encode(body).0.into_owned()),
            ("utf16le", utf16(false)),
            ("utf16be", utf16(true)),
        ];

        for (name, bytes) in cases {
            let path = dir.join(format!("{name}.csa"));
            fs::write(&path, &bytes).expect("書き出し");

            let jkf = read_path_to_jkf(&path, KifuKind::Csa)
                .unwrap_or_else(|e| panic!("{name} の CSA が読めない: {e}"));
            assert!(
                jkf.header.values().any(|v| v == "山田太郎"),
                "{name}: 対局者名が化けている: {:?}",
                jkf.header
            );
            assert_eq!(jkf.moves.len(), 2, "{name}: 指し手が読めていない");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 盤面図だけを書いた CSA の盤面部。これがあると [`says_nothing`] は
    /// 「中身がある」と判定する。`initial.data` は `PI`（駒落ち）や
    /// `P+` / `P-`（駒別）でも埋まるので、書き方はこれだけではない
    const BOARD_ONLY_CSA: &str = "P1 *  *  *  *  * -OU *  *  * \nP2 *  *  *  *  *  *  *  *  * \n\
P3 *  *  *  *  *  *  *  *  * \nP4 *  *  *  *  *  *  *  *  * \n\
P5 *  *  *  *  *  *  *  *  * \nP6 *  *  *  *  *  *  *  *  * \n\
P7 *  *  *  *  *  *  *  *  * \nP8 *  *  *  *  *  *  *  *  * \n\
P9 *  *  *  * +OU *  *  *  * ";

    /// 総当たりの候補が、共有の一覧からずれていない。
    ///
    /// [`ENCODINGS_THE_CRATE_SKIPS`] を手で足すと、**画面が試さない文字コードを
    /// 索引だけが読む**ことになる。増やすなら [`KIFU_ENCODINGS`] のほうを増やして、
    /// 画面（`workspace::record`）も一緒に読めるようにすること。
    #[test]
    fn the_skipped_encodings_are_the_shared_list_minus_the_crates_two() {
        use kifu_text::KIFU_ENCODINGS;

        let crate_tries = [UTF_8, SHIFT_JIS];

        for enc in ENCODINGS_THE_CRATE_SKIPS {
            assert!(
                KIFU_ENCODINGS.contains(&enc),
                "{} が共有の一覧に無い。画面はこの文字コードを試さない",
                enc.name()
            );
        }
        for enc in KIFU_ENCODINGS {
            assert!(
                ENCODINGS_THE_CRATE_SKIPS.contains(&enc) || crate_tries.contains(&enc),
                "{} を索引が試していない",
                enc.name()
            );
        }
    }

    /// **索引が読めた棋譜は、画面も同じ文字列として読める。**
    ///
    /// 索引（ここ）と画面（`workspace::record` の `read_text_portable`）は
    /// 別々の入口だが、**文字コードの判断は `kifu_text` が1人で持つ**。
    /// 持ち主が2人いると、同じファイルについて片方が化けた文字列を見る。
    /// 化けた文字列は `tsshogi` が0手の棋譜にするので、利用者からは
    /// 「検索には出るのに、開くと中身が無い」に見える。
    ///
    /// ここで見るのは**両者が同じ文字列に着く**ことだけ。索引側は誤りを落とす
    /// 復号まで持っているので読める範囲は広いが、その差は
    /// [`LOSSY_DECODERS`] を通った棋譜だけに閉じる。
    ///
    /// 題材は**すべて合成**。
    #[test]
    fn the_index_and_the_viewer_decode_a_kifu_to_the_same_text() {
        use kifu_text::decode_kifu;

        let dir = temp_dir("same-text");
        // `山田太郎` は EUC-JP で全バイトが 0xA1〜0xDF に入るので、
        // Shift_JIS でも誤り無く読めてしまう。順序が効いていないと化ける
        let kifu = "V2.2\nN+山田太郎\nPI\n+\n+7776FU\n-3334FU\n%TORYO\n";

        for enc in [UTF_8, EUC_JP, SHIFT_JIS, ISO_2022_JP, UTF_16LE, UTF_16BE] {
            let name = enc.name();
            let path = dir.join(format!("{name}.csa"));
            fs::write(&path, enc.encode(kifu).0.as_ref()).expect("書き出し");

            // 索引が読める
            let (jkf, _) = read_indexable(&path, KifuKind::Csa)
                .unwrap_or_else(|e| panic!("{name}: 索引が読めない: {e}"));
            assert_eq!(jkf.moves.len(), 4, "{name}: 索引の手数が違う");

            // 画面も同じ文字列に着く
            let bytes = fs::read(&path).expect("読み直し");
            let decoded = decode_kifu(&bytes)
                .unwrap_or_else(|| panic!("{name}: 索引は読めたのに画面が断った"));
            assert_eq!(
                decoded.text.trim_start_matches('\u{feff}'),
                kifu,
                "{name}: 画面が違う文字列を見ている（{} として読まれた）",
                decoded.encoding.name()
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 画面に開くほうの行パターン。
    ///
    /// `viewer_refuses` の doc には tsshogi のパターンを写した表があるが、
    /// **写した表は、写した時点の tsshogi しか知らない**。ここでは
    /// `tests/fixtures/tsshogi_csa_patterns.json` を読んで当てる。
    ///
    /// # なぜ `node_modules` を直接読まないか
    ///
    /// **`cargo test` がクレートの外に依存しなくなるから。** 直接読むと
    /// `npm ci` 済みの作業ツリーでしか通らず、しかも読む先は npm が配る
    /// **ビルド成果物**なので、tsshogi がバンドラを変えて1行にまとめただけで
    /// **obs-shogi と無関係な理由で Rust のテストが赤くなる**。
    ///
    /// fixture が古くなっていないかを見るのは TS 側
    /// （`src/__tests__/tsshogiCsaPatterns.test.ts`）。tsshogi を上げるのは
    /// あちらの仕事なので、ずれたときに落ちるのもあちら。
    /// **正しい持ち主が落ちる**ようにしてある。
    fn viewer_line_patterns() -> Vec<regex::Regex> {
        #[derive(serde::Deserialize)]
        struct Fixture {
            patterns: Vec<String>,
        }

        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/tsshogi_csa_patterns.json");
        let raw = fs::read_to_string(&path).unwrap_or_else(|e| {
            panic!("行パターンの fixture を読めない（{}）: {e}", path.display())
        });
        let fixture: Fixture = serde_json::from_str(&raw)
            .unwrap_or_else(|e| panic!("行パターンの fixture が読めない形になっている: {e}"));

        assert!(
            fixture.patterns.len() > 8,
            "fixture のパターンが {} 個しかない。作り直すこと",
            fixture.patterns.len()
        );

        fixture
            .patterns
            .iter()
            .map(|body| {
                regex::Regex::new(body).unwrap_or_else(|e| {
                    panic!("fixture のパターンを Rust の regex にできない: /{body}/: {e}")
                })
            })
            .collect()
    }

    /// 画面の検査は、画面の行パターンと同じ判定をする。
    ///
    /// [`viewer_refuses`] は、クレートは読むが画面（`tsshogi`）は断る文
    /// （手番・`PI`・盤面の段）を断る。判定が画面とずれると、
    /// 検索に出るのに開けない棋譜か、開けるのに読めませんと言われる棋譜ができる。
    /// 画面の判定は fixture に写したパターンで取る（[`viewer_line_patterns`]）。
    ///
    /// 題材は**すべて合成**。
    #[test]
    fn the_viewer_check_agrees_with_the_viewers_patterns() {
        let patterns = viewer_line_patterns();
        let accepted = |line: &str| patterns.iter().any(|re| re.is_match(line));

        let rank = "P1 *  *  *  *  * -OU *  *  * ";
        let bases = [
            "PI",
            "PI82HI22KA",
            "+",
            "-",
            rank,
            "P1 * * * * * -OU * * *",
            "P1 *  *  *  *  *  *  *",
            "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY",
        ];
        /// 綴りの揺れ1つ。名前と、健全な行を揺らす手続き
        type Wobble = (&'static str, fn(&str) -> String);
        let wobbles: [Wobble; 5] = [
            ("そのまま", |s: &str| s.to_owned()),
            ("末尾に空白", |s: &str| format!("{s} ")),
            ("末尾に空白2つ", |s: &str| format!("{s}  ")),
            ("末尾にタブ", |s: &str| format!("{s}\t")),
            ("末尾の空白を削る", |s: &str| {
                s.trim_end_matches(' ').to_owned()
            }),
        ];

        for base in bases {
            for (wobble, apply) in wobbles {
                let line = apply(base);
                // 画面はファイル末尾の空白を落としてから読むので、行が最後に来ると
                // 末尾の空白の揺れが届かない。コメント行を続けて途中の行にする
                let file = format!("{line}\n'");
                assert_eq!(
                    viewer_refuses(file.as_bytes()).is_some(),
                    !accepted(&line),
                    "画面と判定が食い違う（{wobble}）: {line:?}"
                );
            }
        }
    }

    /// 読めなかったと言うときは、**何を失ったかも言う**。
    ///
    /// 理由だけを出すと「読めない行が1つある」と受け取られる。実際にはその
    /// ファイルの局面が1件も索引に入らないので、あとで検索して出てこなくても
    /// 利用者はそれを「その局面は指されていない」と読む。
    ///
    /// **上限（[`SCREEN_MESSAGE_LIMIT`]）の外で足していることを見る。** 中に入れると
    /// クレートの文言が長いときに刈られて消える。題材はクレートが長い引用を
    /// 返すように、読めない行を上限より長くしてある。
    #[test]
    fn an_unreadable_file_is_told_what_it_costs() {
        let dir = temp_dir("csa-cost");

        for (name, capped_case, kind, ext, body, guidance) in [
            (
                "短い理由",
                false,
                KifuKind::Csa,
                "csa",
                "V2.2\nPI\n+ \n+7776FU\n%TORYO\n".to_owned(),
                "V2.2 のヘッダと手番行",
            ),
            // KIF は読めなかった行を文言に引用するので、行を長くすると上限に当たる
            (
                "上限を超える理由",
                true,
                KifuKind::Kif,
                "kif",
                format!(
                    "手合割：平手\n1 {}\n",
                    "ん".repeat(SCREEN_MESSAGE_LIMIT * 2)
                ),
                "その行を直すか",
            ),
            // **JKF は案内の位置が問われる。** `serde_json` は読めなかった値を
            // 丸ごと引用するので、案内を引用の後ろに置くと刈られて消える
            (
                "上限を超える JKF",
                true,
                KifuKind::Jkf,
                "jkf",
                format!(
                    "{{\"header\":{{}},\"moves\":\"{}\"}}",
                    "7g7f ".repeat(SCREEN_MESSAGE_LIMIT)
                ),
                "元のアプリで書き出し直してください",
            ),
        ] {
            let path = dir.join(format!("{name}.{ext}"));
            fs::write(&path, &body).expect("書き出し");

            let Err(KifuReadError::ParseFailed(message)) = read_path_inner(&path, kind) else {
                panic!("{name}: 読めないはずの題材が読めた");
            };
            // **ここは組んだ直後の値。** 画面まで届くかは `file_build` 側で見る
            let message = message.to_string();
            assert!(
                message.ends_with("このファイルの局面は検索に出ません"),
                "{name}: 失うものを言っていない: {message}"
            );
            // **案内は引用より前に置く。** 後ろに置くと、引用が長い腕で刈られて消える。
            // 末尾の一文は上限の外なので残ってしまい、これが無いと気付けない
            assert!(
                message.contains(guidance),
                "{name}: 案内が刈られて消えた: {message}"
            );
            if capped_case {
                // **題材が実際に刈られたことを見る。** 刈られた本文（上限ちょうど）に
                // 一文が乗るので、全体は必ず上限を超える。上限に届かない題材に
                // すり替わると、上の2つの assert が何も見ていないことに気付けない
                assert!(
                    message.chars().count() > SCREEN_MESSAGE_LIMIT,
                    "{name}: 一文が上限の内側で刈られている: {}文字",
                    message.chars().count()
                );
            }
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 画面が捨てる所の形は、検査でも見ない。
    ///
    /// 画面はファイル全体を `trim` し、`/` だけの行から後ろを捨ててから読む。
    /// 末尾の手番行の空白や、2局目の崩れた行で断ると、**開ける棋譜を索引から落とす**。
    /// 捨てる範囲が広すぎないこと（1局目の崩れた行と、`/` で始まるだけの行）も見る。
    ///
    /// 題材は**すべて合成**。
    #[test]
    fn the_viewer_check_skips_what_the_viewer_drops() {
        for (name, text) in [
            ("手の無い棋譜が手番行の空白で終わる", "V2.2\nPI\n+ "),
            ("同じく改行で終わる", "V2.2\nPI\n+ \r\n"),
            ("BOM の後ろ", "\u{feff}V2.2\nPI\n+ \n"),
            ("2局目の手番行", "V2.2\nPI\n+\n/\nV2.2\nPI\n+ \n"),
            ("CRLF の2局目", "V2.2\r\nPI\r\n+\r\n/\r\nPI \r\n"),
        ] {
            assert!(
                viewer_refuses(text.as_bytes()).is_none(),
                "{name}: 画面が読まない所で断った: {text:?}"
            );
        }

        for (name, text) in [
            ("1局目の手番行", "V2.2\nPI\n+ \n+7776FU\n/\nV2.2\nPI\n+\n"),
            (
                "`/` で始まるだけの行は区切りでない",
                "V2.2\n/x\nPI\n+ \n+7776FU\n",
            ),
            ("段の空きの直後に駒", "P2 *-HI *  *  *  *  * -KA * "),
        ] {
            assert!(
                viewer_refuses(text.as_bytes()).is_some(),
                "{name}: 画面が断る形を通した: {text:?}"
            );
        }
    }

    /// 画面で開けない形は索引でも断り、開ける形は索引でも読む。
    ///
    /// クレートは CSA の仕様に沿って読み、文の後ろの空白を読み飛ばす。画面の
    /// `tsshogi` は手番行と `PI` の末尾の空白を受けず、盤面の段は
    /// 升9つちょうどで、3文字ずつ切って駒名になる形しか受けない。
    /// その差は [`viewer_refuses`] が先に断る。
    ///
    /// 逆に、画面が読まない所は調べない。`/` の行から後ろ（2局目以降）と
    /// ファイル末尾の空白は、画面が捨ててから読む。
    ///
    /// カンマは `tsshogi` も文の区切りとして受けるので、盤面をカンマで繋いだ形は
    /// 両方で読める。
    ///
    /// 題材は**すべて合成**。
    #[test]
    fn what_the_viewer_refuses_the_index_refuses() {
        let dir = temp_dir("csa-viewer-bound");
        let whole = "V2.2\nN+山田\nPI\n+\n+7776FU\n-3334FU\n%TORYO\n";

        let board_csa = format!("V2.2\n{BOARD_ONLY_CSA}\n+\n+5958OU\n%TORYO\n");
        let first_rank = BOARD_ONLY_CSA.split('\n').next().expect("1段目");

        // tsshogi も断る（か、黙って違うものを描く）形。**索引でも断つ**
        for (name, body) in [
            ("手番行の末尾に空白", whole.replace("\n+\n", "\n+ \n")),
            ("PI の末尾に空白", whole.replace("PI\n", "PI \n")),
            (
                "段の末尾に空白が1つ余る",
                board_csa.replace(first_rank, &format!("{first_rank} ")),
            ),
            (
                "段が7升で切れている",
                board_csa.replace(first_rank, "P1 *  *  *  *  *  *  *"),
            ),
            (
                // 行パターンには合うが、画面は ` *-`・`HI ` と切って駒名にならない
                "空きの升の直後に空白なしで駒",
                board_csa.replace(
                    "P2 *  *  *  *  *  *  *  *  * ",
                    "P2 *-HI *  *  *  *  * -KA * ",
                ),
            ),
        ] {
            let path = dir.join(format!("{name}.csa").replace('/', "_"));
            fs::write(&path, &body).expect("書き出し");

            let read = read_path_inner(&path, KifuKind::Csa);
            assert!(
                matches!(read, Err(KifuReadError::ParseFailed(_))),
                "{name}: 画面で開けない形を索引に入れた"
            );
        }

        // tsshogi が受ける形。**索引でも読める**
        let mut board_trimmed = String::new();
        for line in BOARD_ONLY_CSA.split('\n') {
            board_trimmed.push_str(line.trim_end());
            board_trimmed.push('\n');
        }
        for (name, body) in [
            (
                "駒別の持駒行の末尾に空白",
                "V2.2\nPI\nP+00FU\nP-00KY\n+\n+7776FU\n%TORYO\n".replace("P+00FU\n", "P+00FU \n"),
            ),
            (
                "盤面の段の最後の空升の空白が消えている",
                format!("V2.2\n{}+\n+5958OU\n%TORYO\n", board_trimmed),
            ),
            (
                // 画面は `/` の行から後ろを捨てるので、2局目の手番行の空白は見ない
                "2局目の手番行の末尾に空白",
                format!("{whole}/\nV2.2\nPI\n+ \n+2726FU\n%TORYO\n"),
            ),
            ("ファイル末尾に空白行", format!("{whole} \n\t\n")),
            (
                "盤面をカンマで繋いだ",
                format!(
                    "V2.2\n{}\n+\n+5958OU\n-4142OU\n%TORYO\n",
                    BOARD_ONLY_CSA.replace('\n', ",")
                ),
            ),
        ] {
            let path = dir.join(format!("{name}.csa").replace('/', "_"));
            fs::write(&path, &body).expect("書き出し");

            let (jkf, warns) = read_indexable(&path, KifuKind::Csa)
                .unwrap_or_else(|e| panic!("{name}: 画面で開ける形を索引が断った: {e}"));
            assert!(
                jkf.moves.len() >= 2,
                "{name}: 手が読めていない: {}",
                jkf.moves.len()
            );
            assert!(warns.is_empty(), "{name}: 直しようの無い警告: {warns:?}");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 画面が読む綴りは索引でも読み、読めない行は行を名指しして断る。
    ///
    /// 画面（`tsshogi`）は、指し手の後ろの空白・タブ、アポストロフィだけの行、
    /// 最後の行の改行なしを気にせず読む。索引側（クレート）も同じく読む。
    ///
    /// 棋譜の形をしていない行が指し手の間に混ざると、クレートは KIF と同じく
    /// その行を名指しして断る。途中までの記録を `Ok` にはしない。
    ///
    /// 題材は**すべて合成**。
    #[test]
    fn csa_spelling_the_viewer_reads_is_read_and_a_broken_line_is_named() {
        let dir = temp_dir("csa-spelling");
        let whole = "V2.2\nN+山田\nPI\n+\n+7776FU\n-3334FU\n%TORYO\n";
        // アプリが対局者名なしで書き出す形（`try_to_csa_owned` は空のヘッダを書かない）
        let headerless = "V2.2\nPI\n+\n+7776FU\n-3334FU\n%TORYO\n";

        /// 健全な CSA の綴りを揺らす
        type Wobble = (&'static str, &'static dyn Fn(&str) -> String);
        let readable: [Wobble; 5] = [
            ("1手目の末尾に空白", &|s: &str| {
                s.replace("+7776FU\n", "+7776FU \n")
            }),
            ("2手目の末尾に空白", &|s: &str| {
                s.replace("-3334FU\n", "-3334FU \n")
            }),
            ("手のあとにタブ", &|s: &str| {
                s.replace("+7776FU\n", "+7776FU\t\n")
            }),
            ("アポストロフィだけの行", &|s: &str| {
                s.replace("-3334FU\n", "'\n-3334FU\n")
            }),
            ("最後の行の改行なし", &|s: &str| {
                s.trim_end().to_owned()
            }),
        ];

        for (base_name, base) in [("ヘッダあり", whole), ("ヘッダなし", headerless)] {
            for (wobble, apply) in
                std::iter::once::<Wobble>(("そのまま", &|s: &str| s.to_owned())).chain(readable)
            {
                let name = format!("{base_name}/{wobble}");
                let path = dir.join(format!("{name}.csa").replace('/', "_"));
                fs::write(&path, apply(base)).expect("書き出し");

                let (jkf, warns) = read_indexable(&path, KifuKind::Csa)
                    .unwrap_or_else(|e| panic!("{name}: 画面が読む綴りを断った: {e}"));
                assert_eq!(jkf.moves.len(), 4, "{name}: 全部読めていない");
                assert!(warns.is_empty(), "{name}: 直しようの無い警告: {warns:?}");
            }

            let path = dir.join(format!("broken-{base_name}.csa"));
            let body = base.replace("-3334FU\n", "ZZZZ これは棋譜の行ではない\n-3334FU\n");
            fs::write(&path, &body).expect("書き出し");
            let Err(KifuReadError::ParseFailed(message)) = read_path_inner(&path, KifuKind::Csa)
            else {
                panic!("{base_name}: 読めない行がある記録を通した");
            };
            assert!(
                message.to_string().contains("ZZZZ"),
                "{base_name}: 読めなかった行を名指ししていない: {message}"
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 終局の後ろに続くものは、記録を断る理由にならない。
    ///
    /// 2局を1ファイルに置く形（`/` の有無を問わない）と、感想戦の書き起こしを
    /// 終局の後ろに置く形が実際にある。クレートは終局（`%`）の後ろの、CSA の文
    /// として読めない行で記録を終える（クレートの判断 D36）。終局の後ろの
    /// 指し手の形の行は、中断と再開でありうるので読む。
    ///
    /// 題材は**すべて合成**。
    #[test]
    fn a_csa_that_reached_its_end_gets_no_warning() {
        let dir = temp_dir("csa-not-cut");
        let whole = "V2.2\nN+山田\nPI\n+\n+7776FU\n-3334FU\n+2726FU\n-8384FU\n%TORYO\n";
        let timed_out = "V2.2\nN+山田\nPI\n+\n+7776FU\n%TIME_UP\n";

        let cases: [(&str, String); 5] = [
            ("2局を連結", format!("{whole}{whole}")),
            ("2局を区切りで分ける", format!("{whole}/\n{whole}")),
            (
                "終局の後ろに解説行",
                format!("{whole}-3122GI が敗着だった\n"),
            ),
            ("終局の後ろに指し手の形の行", format!("{whole}-3122GI\n")),
            (
                "special にしない終局のあとに2局目",
                format!("{timed_out}{whole}"),
            ),
        ];

        for (name, body) in cases {
            let path = dir.join(format!("{name}.csa"));
            fs::write(&path, &body).expect("書き出し");

            let (jkf, warns) = read_indexable(&path, KifuKind::Csa)
                .unwrap_or_else(|e| panic!("{name}: 読めている CSA を断った: {e}"));
            assert!(
                jkf.moves.iter().any(|m| m.move_.is_some()),
                "{name}: 指し手が1つも入っていない"
            );
            assert!(warns.is_empty(), "{name}: 余計な警告が出た: {warns:?}");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 棋譜として読めなかった理由も、4形式とも利用者の言葉で出す。
    ///
    /// **ファイルを開けない経路とは別。** こちらはファイルが開けたあと、
    /// 中身が棋譜でなかったときの話。案内を付けないと、`describe` を通らない
    /// JKF はクレートの英語がそのまま画面に出る。
    /// `KifuReadError::ParseFailed` の doc が定めた「次に何をすればよいか」を、
    /// **`describe` を通る形式だけが満たしている**状態になりやすい。
    #[test]
    fn why_a_file_is_not_a_kifu_is_said_in_every_format() {
        let dir = temp_dir("not-a-kifu");

        // (拡張子, 中身, 文言に必ず含まれるもの)
        // **クレートが読めた経路だけでは `describe` の総当たり側の腕を通らない。**
        // Shift_JIS / UTF-8 の壊れた棋譜はクレートが `ParseError::Kif` を返すので
        // `unreadable_record` が案内を付けるが、EUC-JP / BOM 無しの UTF-16 /
        // ISO-2022-JP は総当たりが読んだ側に落ちる。そちらにも案内が要る
        let broken_move = "先手：山田\n後手：田中\n手合割：平手\n\
                           手数----指手---------消費時間--\n   1 ZZZZ\n";
        let cases: [(&str, KifuKind, Vec<u8>, &str); 6] = [
            (
                "csa",
                KifuKind::Csa,
                b"this is not a csa file\n".to_vec(),
                "CSA として読めません",
            ),
            (
                "jkf",
                KifuKind::Jkf,
                br#"{"header":"#.to_vec(),
                "JKF（JSON）として壊れています",
            ),
            (
                "kif",
                KifuKind::Kif,
                b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\n".to_vec(),
                "棋譜として読めない行があります",
            ),
            (
                "ki2",
                KifuKind::Ki2,
                b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\n".to_vec(),
                "棋譜として読めない行があります",
            ),
            // クレートが試さない文字コード。総当たりが読んだ側に落ちる
            (
                "kif",
                KifuKind::Kif,
                EUC_JP.encode(broken_move).0.into_owned(),
                "棋譜として読めない行があります",
            ),
            (
                "kif",
                KifuKind::Kif,
                UTF_16LE.encode(broken_move).0.into_owned(),
                "棋譜として読めない行があります",
            ),
        ];

        for (i, (ext, kind, body, must_say)) in cases.into_iter().enumerate() {
            let path = dir.join(format!("case{i}.{ext}"));
            fs::write(&path, &body).expect("書き出し");
            let err = read_path_to_jkf(&path, kind)
                .err()
                .unwrap_or_else(|| panic!("case{i}: 読めてしまった"));
            let message = err.to_string();
            assert!(
                message.contains(must_say),
                "case{i}: 「{must_say}」を言っていない: {message}"
            );
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 手合割つきの棋譜が読める。
    ///
    /// 手合割の盤面はクレートの `Preset`（`shogi_core/from.rs`）が持つ。表に無い名前は
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
