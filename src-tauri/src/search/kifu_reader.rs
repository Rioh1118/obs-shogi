use std::{
    borrow::Cow,
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
    path::Path,
};

use thiserror::Error;

use crate::search::fs_scan::{FileRecord, KifuKind};

// shogi-kifu-converter
use shogi_kifu_converter_obsshogi::parser::{
    parse_csa_file, parse_csa_str, parse_jkf_file, parse_ki2_file, parse_ki2_str, parse_kif_file,
    parse_kif_str,
};

use encoding_rs::{Encoding, EUC_JP, ISO_2022_JP, SHIFT_JIS, UTF_16BE, UTF_16LE};
use shogi_kifu_converter_obsshogi::error::ParseError;

/// 棋譜1つ分。クレートの JKF をそのまま使う
pub type Jkf = shogi_kifu_converter_obsshogi::jkf::JsonKifuFormat;

/// 棋譜を JKF にできなかった理由
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

    /// **読めた。ただし索引に入れる局面が無い。**
    ///
    /// 中身の無いファイルを索引に入れると、平手の初期局面で検索したときに
    /// 全部ヒットし、開いても初期局面しか出ないので「そういう棋譜」と誤解される。
    /// だから局面は入れない。
    ///
    /// **入れる局面が無いこと自体は失敗ではない。** 同じ形になるのは
    /// 「保存が途中で終わった跡」だけではない — **このアプリの新規作成で
    /// 対局者名を入れずに作ったファイルがちょうどこの形**になる
    /// （`create_kifu_file` → `try_to_*_owned`）。それを「壊れている」と
    /// 告げるのは嘘で、しかも利用者は直しようが無い。
    ///
    /// **ただし `warn` があれば出すこと。** 中身が空に見える記録には
    /// 「本当に空」と「読めなかったせいで空に見える」の2つがあり、後者は
    /// 利用者に伝えないと**指し手のある棋譜が黙って索引から消える**
    /// （対局者名を書かない CSA が1手目で切れると、`says_nothing` が真になる）。
    /// 空なら何も出さない。
    ///
    /// **登録するかどうかはこの腕が決めていない**（[`KifuReadError::ParseFailed`] でも
    /// 同じ「局面を持たない項目」が積まれる）。登録そのものが要る理由は別で、
    /// **`file_table` の gen が上がらないと前の世代のセグメントが索引に残る**
    /// （`project_manager` の `build_one_file` が `None` を返したときの腕）。
    #[error("索引に入れる局面がありません")]
    NothingToIndex {
        /// 空に見える理由が利用者に関係あるなら、その文言。無ければ `None`
        warn: Option<String>,
    },
}

/// 読めた記録と、読めたけれど伝えたいこと。
///
/// **`warns` は失敗ではない。** 記録は索引に入る。呼び手は `build_index_for_jkf` の
/// `warns` と同じ口（`EVT_INDEX_WARN`）へ流すこと。
pub struct ReadOutcome {
    pub jkf: Jkf,
    /// 利用者に出す文言。空なら何も出さない
    pub warns: Vec<String>,
}

/// 走査で見つけたファイルを読む。**索引を作る経路はこちらを呼ぶ。**
///
/// # 形式ごとに手当てが違う
///
/// | 形式 | 文字コードの総当たり | パニックを捕まえる | 読み残し |
/// | --- | --- | --- | --- |
/// | KIF / KI2 | する（[`read_portable`]） | しない | クレートが断る |
/// | CSA | する（[`read_portable`]） | **する**（[`parse_csa_portable`]） | **こちらが見つけて `warns` に積む**（[`warn_if_moves_were_dropped`]） |
/// | JKF | しない（JSON なので UTF-8） | しない | — |
///
/// 非対称の理由はそれぞれの関数の doc にある。
/// `.csa` が [`KifuReadError::ParseFailed`] になる経路は、クレートが断った／
/// パニックを捕まえた、の2つ。**読み残しはここに入らない** — `warns` に積むだけで、
/// 記録を落とすかどうかは [`says_nothing`] だけが決める。
///
/// # Errors
///
/// 2つある。**どちらを返すかで、呼び手のすることが変わる。**
///
/// | 腕 | 何が起きたか | 呼び手のすること |
/// | --- | --- | --- |
/// | [`KifuReadError::ParseFailed`] | 読めなかった | 文言を警告として出す |
/// | [`KifuReadError::NothingToIndex`] | 読めたが入れる局面が無い | **`warn` があればそれだけ出す** |
///
/// **項目の登録はどちらも同じ。** 全件構築（`api`）も差分更新（`project_manager`）も、
/// 局面を1つも持たない項目として登録する（`project_manager` は
/// `build_one_file` が `None` を返したときに呼び手側で積む）。
/// どちらの経路でも、その棋譜の局面は検索に出てこない。
///
/// **`Ok` でも `warns` が空とは限らない。** 5つの戻りを並べた表は
/// `docs/state-transitions/search.md`（この関数を主語にしている）。
pub fn read_to_jkf(rec: &FileRecord) -> Result<ReadOutcome, KifuReadError> {
    let (jkf, warns) = read_path_inner(&rec.path, rec.kind)?;
    Ok(ReadOutcome { jkf, warns })
}

/// 誤りを落とす復号1つ
type LossyDecoder = fn(&[u8]) -> Cow<'_, str>;

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
const LOSSY_DECODERS: [LossyDecoder; 2] = [
    |bytes| String::from_utf8_lossy(bytes),
    |bytes| SHIFT_JIS.decode(bytes).0,
];

/// 読めた記録に、索引へ入れる局面が無いか。
///
/// **パーサは中身の無いファイルを「平手の初期局面1件」として `Ok` で返す。**
/// そのまま索引に入れると平手の初期局面で検索したときに全部ヒットし、開いても
/// 初期局面しか出ないので「そういう棋譜」と誤解される。だから入れない。
///
/// **これは「壊れている」の判定ではない。** [`KifuReadError::NothingToIndex`]
/// の doc のとおり、同じ形になるものにはこのアプリが作った新しい棋譜も含まれる。
///
/// # バイト列でなく、読めた記録の形で決める
///
/// **バイト列を先に検査すると、検査した文字コードの集合と、
/// あとで実際に読み通す集合とがずれる。** 読み手が通すのは
/// クレートの2つ・[`ENCODINGS_THE_CRATE_SKIPS`] の4つ・[`LOSSY_DECODERS`] の2つで、
/// 事前の門でそれを再現しようとすると、復号を1つ足すたびに片方だけ増えて穴が空く。
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
/// **[`crate::search::index_builder`] がその欄を歩かない。** `forks` を読むのは
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
        .map_or(true, |m| m.comments.is_none() && m.special.is_none())
}

/// 利用者に出す文言の上限。
///
/// クレートのエラーは**読めなかった位置から行末までを引用する**ので、
/// 改行を含まない大きなファイル（`.kif` に改名した zip など）では
/// ファイルの中身がそのまま文言になる。これが `IndexWarnPayload` に載り、
/// webview の state に200件まで溜まる。
const MESSAGE_LIMIT: usize = 300;

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
    read_path_inner(path, kind).map(|(jkf, _)| jkf)
}

/// 棋譜ファイルを JKF に読み、伝えたいことも返す。**読み手の本体。**
///
/// 表と腕ごとの義務は [`read_to_jkf`] の doc にある。
fn read_path_inner(path: &Path, kind: KifuKind) -> Result<(Jkf, Vec<String>), KifuReadError> {
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
                 棋譜ではないファイルに棋譜の拡張子が付いていないか確かめてください",
                meta.len().div_ceil(1024 * 1024),
                SIZE_LIMIT / (1024 * 1024),
            )));
        }
    }

    let jkf = match kind {
        KifuKind::Kif => parse_kif_portable(path),
        KifuKind::Ki2 => parse_ki2_portable(path),
        KifuKind::Csa => parse_csa_portable(path),
        KifuKind::Jkf => parse_jkf_file(path).map_err(|e| parse_failed(unreadable_record(e))),
    }?;

    // 2つの問いを別々に答えさせ、ここでは**受け取るだけ**にする。
    //
    // | 問い | 持ち主 | 権限 |
    // | --- | --- | --- |
    // | 索引に入れる局面があるか | [`says_nothing`] | 記録を落とせる |
    // | 最後まで読めたか | [`warn_if_moves_were_dropped`] | **警告だけ。落とせない** |
    //
    // **どちらの判断もここで再導出しない。** 片方の条件をもう片方へ書き写すと、
    // 写し落としがそのまま索引の穴になる（`preset` を見落として駒落ちの
    // 初期局面を落とした例がある）。
    //
    // 読めたかを先に見るのは、`says_nothing` が真の記録でも
    // **なぜ空に見えるのかを伝えたい**から。対局者名を書かない CSA が
    // 1手目で切れると `says_nothing` は真になるが、それは「本当に空」ではない。
    let warn = match kind {
        KifuKind::Csa => warn_if_moves_were_dropped(&file, &jkf),
        _ => None,
    };

    if says_nothing(&jkf) {
        return Err(KifuReadError::NothingToIndex { warn });
    }

    Ok((jkf, warn.into_iter().collect()))
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
/// # 総当たりの外側で捕まえる
///
/// 候補ごとに包むと、パニックした候補だけを飛ばして次を試せる。そうしていないのは、
/// **パニックを起こす値が候補によって変わらない**から。落ちるのは `$START_TIME` の
/// 日付と `T` 行の桁数で、どちらも ASCII。
///
/// ASCII をそのまま通す候補は、クレートが試す2つ（[`ENCODINGS_THE_CRATE_TRIES`]）と、
/// [`ENCODINGS_THE_CRATE_SKIPS`] のうち UTF-16 でない2つ（EUC-JP / ISO-2022-JP）、
/// [`LOSSY_DECODERS`] の2つ。**そのどれで復号しても同じ位置で落ちる**
/// （実測: ISO-2022-JP で書いた `2004/02/30` は UTF-8 / Shift_JIS /
/// EUC-JP / ISO-2022-JP のどれで復号してもパニックする）。
/// UTF-16 の2つは本文が CSA の形にならないので、パニックの手前で読めずに終わる。
fn parse_csa_portable(path: &Path) -> Result<Jkf, KifuReadError> {
    // `read_portable` はローカルに確保して返すだけで、パニックの向こうへ
    // 壊れた不変条件を持ち越す状態を持たない
    let attempt = AssertUnwindSafe(|| read_portable(path, |p| parse_csa_file(p), parse_csa_str));
    match catch_unwind(attempt) {
        Ok(result) => result,
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

/// CSA が途中で読むのをやめていたら、そのことを伝える文言を返す。
///
/// **断らない。** 読めたところまでの局面は索引に入れる価値があるので、
/// 記録は通して警告だけを出す。断ると**そのファイルの局面が1件も入らなくなり**
/// （`ParseFailed` は `api` / `project_manager` の両方で空の bucket に落ちる）、
/// 誤検知したときに失うものが大きすぎる。数え方の判定が外れても、
/// この形なら余計な警告が1つ出るだけで済む。
///
/// **CSA には読み残しの番人が無い。** KIF / KI2 はクレートが読み残りを
/// `ParseError::Kif` / `Ki2` にし（`parser.rs` の `stopped_at`）、何も認識できなければ
/// `recognised_nothing` で断るが、**`parse_csa_str` はどちらも通らない** —
/// `csa` クレートの `parse_csa` が `game_record` の残り入力を `_` で捨てて `Ok` を返す。
///
/// 実測すると、指し手行の末尾に半角スペースが1つ入っただけで
/// **そこから後ろの全部が消えたまま `Ok`** になる。対局者名が無ければ
/// [`says_nothing`] も真になるが、**この文言は
/// [`KifuReadError::NothingToIndex`] の `warn` に載せて呼び手へ渡す**
/// （`read_path_inner` がこの検査を門より前に置いているのはそのため）。
///
/// # 数え方は当てにいかない
///
/// この数え方は**クレートの文法を写していない**ので、外れることがある。
///
/// - `%MATTA` や `%CHUDAN` の後ろに指し手が続く記録では、`%` の行で数を打ち切るので
///   落ちた手を**数え落とす**（＝黙る）
/// - 終局行を持たない記録が2つ繋がっていると、2局目の指し手を**数えすぎる**
///   （＝余計な警告が出る）
///
/// どちらも索引の中身は変わらない。**外れる方向を選べないので、
/// 外れても害の無い出口（警告）にしてある。**
///
/// # バイト列で数える
///
/// 復号したあとの文字列ではなくファイルのバイト列を見るのは、**CSA の指し手行が
/// ASCII だから**。ASCII をそのまま通す候補（[`ENCODINGS_THE_CRATE_TRIES`] の2つ、
/// [`ENCODINGS_THE_CRATE_SKIPS`] のうち UTF-16 でない2つ、[`LOSSY_DECODERS`] の2つ）は
/// どれも同じ数を出すので、どの候補で読めたかに関わらず結果が変わらない。
/// UTF-16 はバイト列に NUL が挟まって指し手行の形にならず0件と数える（＝黙る）。
///
/// # なぜもう一度読むのか
///
/// クレートが一発で読めた経路にはバイト列が手元に無い（`parse_csa_file` が
/// 自分で開いて読み、文字列だけを返す）。**[`read_path_inner`] が大きさを見るために
/// 開いた `File` を使い回す**ので、`open` は増えない。
/// ただし**読みは増える** — 切れていない CSA も含め、`.csa` は全件が2度読まれる
/// （クレートが1回、ここで1回）。`SIZE_LIMIT` までのバイト列を
/// もう1つ確保することになる。
///
/// `file` は `jkf` を作った当のファイルを開いたものであること
/// （[`read_path_inner`] が開いた `File` をそのまま渡す）。**別のファイルを渡すと突き合わせが
/// 成立しない**（型は止めない）。読み直しとパースの間にそのファイルが保存されると
/// 数える側とパース側で中身が違うが、出口が警告なので実害は「余計な警告が1つ」だけ。
fn warn_if_moves_were_dropped(file: &fs::File, jkf: &Jkf) -> Option<String> {
    use std::io::{Read as _, Seek as _, SeekFrom};

    let mut handle = file.try_clone().ok()?;
    handle.seek(SeekFrom::Start(0)).ok()?;
    let mut bytes = Vec::new();
    handle.read_to_end(&mut bytes).ok()?;

    let read = jkf.moves.iter().filter(|m| m.move_.is_some()).count();
    let mut moves_seen = 0usize;
    for (line_no, line) in bytes.split(|b| *b == b'\n').enumerate() {
        // `%` の行から先は数えない。**終局とは限らない** — `%MATTA` や `%CHUDAN` の
        // 後ろにも指し手は続き、クレートはそれを読む。どこまでがこの記録かを
        // バイト列だけからは決められないので、最初の `%` で打ち切って
        // 数え落とす側（＝黙る側）に倒す。
        // クレートが `special` にしない終局理由（`%TIME_UP` など）もここで止まる
        if line.starts_with(b"%") {
            break;
        }
        if !is_csa_move_line(line) {
            continue;
        }
        moves_seen += 1;
        if moves_seen > read {
            // `enumerate` は0始まり。利用者が数えるのはファイルの行番号なので1を足す
            return Some(format!(
                "CSA を {read} 手までしか読めませんでした。\
                 ファイルの {} 行目（{moves_seen} 手目）から先の指し手は検索に出ません。\
                 その行と手前の行に、余分な空白やカンマ、\
                 アポストロフィだけの行が無いか、\
                 ファイルの最後に改行があるかを確かめてください",
                line_no + 1
            ));
        }
    }

    None
}

/// その行が CSA の指し手か。**`+7776FU` の形だけを数える。**
///
/// 手番だけの `+` / `-`、`P` で始まる盤面、`T` の消費時間、`%` の終局、
/// `'` のコメント、`$` や `N` のヘッダはどれも形が違うので数に入らない。
/// 終局（`%TORYO`）を数えないのは、`jkf` 側で `special` に入って
/// `move_` にならないため — 数える側と数えられる側を揃える。
fn is_csa_move_line(line: &[u8]) -> bool {
    // 行末の `\r` は落とす。CRLF のファイルで全行が外れる
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    line.len() >= 7
        && matches!(line[0], b'+' | b'-')
        && line[1..5].iter().all(u8::is_ascii_digit)
        && line[5..7].iter().all(u8::is_ascii_uppercase)
}

/// クレートの理由を、そのまま利用者に出せる文言にする。
///
/// **形式ごとの案内を持つのはここだけ。** 総当たりを掛けない JKF は
/// [`read_path_inner`] から直に、掛ける3形式は候補を選んだあとの
/// [`describe`] から呼ばれる。どちらの経路でも同じ案内が出る。
///
/// [`KifuReadError::ParseFailed`] の doc が定めた「何が読めなかったかと
/// 次に何をすればよいか」を満たすのはこの関数の仕事。クレートの文言は
/// **行番号と読めなかった行の本文**を持っていて役に立つので捨てないが、
/// `KIF Error: 0: at line 2, in this move cannot be read` は `nom` の語彙で、
/// 利用者の言葉ではない。前に1文を置いて、何をすればよいかを言う。
///
/// **埋め込む前に [`capped`] を通す。** クレートの文言は
/// 「読めなかった位置から行末まで」を引用するので、改行の無いファイルでは
/// ファイルの中身がまるごと1本の `String` になる。
/// 刈るのを [`parse_failed`] まで遅らせると、刈る対象が先に出来上がる。
fn unreadable_record(e: ParseError) -> String {
    let by_crate = capped(&e);
    match e {
        // `parse_jkf_file` は `read_to_string` するので、UTF-8 でない `.jkf` は
        // 必ずここに来る。**総当たりを掛ける3形式はここに来ない** —
        // クレートがバイト列から文字コードを決め、決められなければ
        // `Decode` を返す
        ParseError::Io(io) if io.kind() == std::io::ErrorKind::InvalidData => {
            "UTF-8 として読めませんでした。Shift_JIS で保存されている可能性があります。\
             UTF-8 で保存し直してください"
                .to_owned()
        }
        ParseError::Io(io) => cannot_open_reason(&io),
        ParseError::Csa(_) | ParseError::CsaConvert(_) => format!(
            "CSA として読めません。V2.2 のヘッダと手番行（+ か -）があるか\
             確かめてください（{by_crate}）"
        ),
        ParseError::Serde(_) => format!(
            "JKF（JSON）として壊れています（{by_crate}）。\
             元のアプリで書き出し直してください"
        ),
        ParseError::Kif(_) | ParseError::Ki2(_) => format!(
            "棋譜として読めない行があります。その行を直すか、\
             拡張子が中身と合っているか確かめてください:\n{by_crate}"
        ),
        // 文字コードの話。総当たりを掛ける3形式（KIF / KI2 / CSA）は
        // [`describe`] が先に扱うので、ここに来るのは JKF だけ
        ParseError::Decode | ParseError::FileExtension => format!(
            "{by_crate}: 文字として読めませんでした。\
             棋譜ではないファイルに棋譜の拡張子が付いていないか確かめてください"
        ),
        // 局面に合わない手。手合割の名前がクレートの表に無い、書き写しを誤った、
        // 駒がいない升から動かした、など。文字コードとは関係が無い。
        // **クレートの本文は何手目・どの升を名指しするので捨てない**
        ParseError::Normalize(_) => format!(
            "書かれている手が局面に合いません。手合割の名前がこのアプリの知っている\
             ものか、その手数のところで指し手が書き写せているか確かめてください\
             （{by_crate}）"
        ),
    }
}

/// クレートの文言を、埋め込む前に [`MESSAGE_LIMIT`] 文字で刈る。
///
/// **刈るのを最後まで遅らせると、刈る対象が先に出来上がる。**
/// `ParseError` の `Display` は読めなかった位置から行末までを引用するので、
/// 埋め込みで作る `format!` の結果がファイルの大きさになる。
/// ここで刈ると `describe` の戻り値は 4 MiB → 440 バイトになる。
///
/// **クレートが持っている引用文そのものは消せない。**
/// `ParseError::Kif` は `Kif(String)` で、引用はパース時に確定して保持されている
/// （4 MiB の1行ファイルで内部の `String` が 4,194,343 バイト）。
/// **確保のピークを頭打ちにしているのは [`SIZE_LIMIT`] のほう。**
fn capped(e: &dyn std::fmt::Display) -> String {
    use std::fmt::Write as _;
    let mut sink = Capped::default();
    let _ = write!(sink, "{e}");
    sink.finish()
}

/// 読めなかった理由を、利用者に出せる形にして包む。
///
/// **[`KifuReadError::ParseFailed`] を作る口はここだけ。** 長さと制御文字を落とすのを
/// 各所でやると必ず漏れる。[`KifuReadError::NothingToIndex`] の `warn` は
/// **数だけを埋める定型文**なので刈る対象が無く、ここを通らず直に組む。
/// **クレート由来の文言を混ぜるなら、ここか [`capped`] を通すこと。**
///
/// **上限は組みながら掛ける。** `to_string()` を先に呼ぶと、
/// クレートが引用する「読めなかった位置から行末まで」が丸ごと確保される。
/// クレートの文言を文中に埋める側（[`unreadable_record`] / [`describe`]）も
/// 同じ理由で [`capped`] を通す。ここだけで刈ると、刈る対象が先に出来上がる。
fn parse_failed(e: impl std::fmt::Display) -> KifuReadError {
    use std::fmt::Write as _;

    let mut sink = Capped::default();
    // `Display` は `Ok` しか返さないが、`Capped` は上限で `Err` を返して
    // 書き手を止める。どちらも文言としては完成しているので結果は見ない
    let _ = write!(sink, "{e}");
    KifuReadError::ParseFailed(sink.finish())
}

/// [`MESSAGE_LIMIT`] 文字まで書き取る受け皿。**超えたぶんは組み立てない。**
///
/// 上限に達したら `Err` を返して書き手を止めるので、
/// **`Display` の実装が引用しようとしている残りは `String` にならない。**
#[derive(Default)]
struct Capped {
    out: String,
    taken: usize,
    truncated: bool,
}

impl Capped {
    fn finish(mut self) -> String {
        if self.truncated {
            self.out.push('…');
        }
        self.out
    }
}

impl std::fmt::Write for Capped {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        for c in s.chars() {
            if self.taken >= MESSAGE_LIMIT {
                self.truncated = true;
                // 書き手を止める。`Display` の実装は途中で抜けても
                // ここまでに書かれたものを壊さない
                return Err(std::fmt::Error);
            }
            // 制御文字は画面に出しても意味が無く、生の NUL やエスケープが混ざる
            self.out
                .push(if c == '\n' || !c.is_control() { c } else { ' ' });
            self.taken += 1;
        }
        Ok(())
    }
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
    fs::read(path).map_err(cannot_open)
}

/// ファイルそのものを開けなかった／読めなかったことを [`KifuReadError`] にする。
///
/// **`os error 13` から権限を疑える利用者はいない。** この経路の文言も
/// 索引の警告としてそのまま画面に出るので、他と同じく次の行動まで言う。
///
/// **[`unreadable_record`] とは別物。** あちらは「開けたが棋譜ではない」。
/// 名前が近いと呼び違えるが、`ParseError::Io` の腕では**型が合ってしまう**ので
/// コンパイラは止めない。
fn cannot_open(e: std::io::Error) -> KifuReadError {
    parse_failed(cannot_open_reason(&e))
}

/// [`cannot_open`] の文言だけ。`ParseError::Io` を包み直すときに使う。
fn cannot_open_reason(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => {
            "ファイルを開く権限がありません。権限を確かめるか、この場所を索引から外してください"
                .to_owned()
        }
        std::io::ErrorKind::NotFound => "索引を作っている間にファイルが無くなりました".to_owned(),
        // `ErrorKind` の Debug は内部の識別子なので出さない
        _ => {
            "ファイルを読めませんでした。ディスクやネットワークの接続を確かめてください".to_owned()
        }
    }
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
    // BOM の並びは手で書かない。`encoding_rs` が同じ表を持っており、
    // 写すと片方だけ動かしたときに黙って食い違う
    if let Some((encoding, _)) = Encoding::for_bom(bytes) {
        return Some(encoding);
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
fn describe(by_crate: ParseError, evidence: &Evidence, by_fallback: Option<Unparsable>) -> String {
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
                let tried: Vec<&str> = ENCODINGS_THE_CRATE_TRIES
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::test_kifu::{one_move_kif, HANDICAPS};
    use crate::test_support::temp_dir;
    use encoding_rs::SHIFT_JIS;
    use shogi_kifu_converter_obsshogi::error::{NormalizeError, NormalizeErrorKind};
    use shogi_kifu_converter_obsshogi::jkf::{Initial, MoveFormat, MoveSpecial, Preset};

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
    /// [`parse_csa_portable`] が捕まえる。
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
            let err = read_path_to_jkf(&path, KifuKind::Kif)
                .err()
                .unwrap_or_else(|| panic!("{label} を弾いていない"));
            // **黙って弾くこと。** `{ .. }` で受けると `warn` が付いても緑になる
            let KifuReadError::NothingToIndex { warn } = err else {
                panic!("{label} が読めなかった扱いになっている: {err}");
            };
            assert!(warn.is_none(), "{label} が警告つきで弾かれている: {warn:?}");
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
            let Err(KifuReadError::NothingToIndex { .. }) = read_path_to_jkf(&path, KifuKind::Jkf)
            else {
                panic!("{label}: 誰も歩かない変化を索引に入れている");
            };
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

    /// 文言の受け皿そのものの境界。
    ///
    /// 通し経路のテストは「出てきた文言が短いこと」しか見ないので、
    /// **上限ちょうどで1文字余計に落とす / 1文字余計に通す**を区別できない。
    /// `write_str` が複数回に分かれる呼ばれ方も、通し経路では起きないことがある。
    #[test]
    fn the_message_sink_stops_exactly_at_the_limit() {
        use std::fmt::Write as _;

        // 上限ちょうどは省略記号を付けない
        let mut sink = Capped::default();
        write!(sink, "{}", "あ".repeat(MESSAGE_LIMIT)).expect("上限ちょうどで止められた");
        let out = sink.finish();
        assert_eq!(out.chars().count(), MESSAGE_LIMIT);
        assert!(!out.ends_with('…'), "上限ちょうどで省略している");

        // 1文字超えたら省略記号が付き、本文は上限で止まる
        let mut sink = Capped::default();
        let _ = write!(sink, "{}", "あ".repeat(MESSAGE_LIMIT + 1));
        let out = sink.finish();
        assert_eq!(out.chars().count(), MESSAGE_LIMIT + 1);
        assert!(out.ends_with('…'), "省略記号が無い");

        // **書き込みが分かれても、通算で数える。**
        // 1回ぶんで数えていると、`format!` の引数の切れ目で上限が甘くなる
        let mut sink = Capped::default();
        for _ in 0..10 {
            let _ = write!(sink, "{}", "い".repeat(MESSAGE_LIMIT));
        }
        assert_eq!(sink.finish().chars().count(), MESSAGE_LIMIT + 1);

        // 制御文字は空白に置き換える。生の NUL やエスケープが画面に出ない
        let mut sink = Capped::default();
        write!(sink, "a\0b\x1bc\nd").expect("書けること");
        assert_eq!(sink.finish(), "a b c\nd");
    }

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
    /// **見ているのは綴りの段（`spell_for_extension`）だけ。**
    /// `create_kifu_file` はその手前で `normalize()` を通すので、
    /// そちらが空の JKF に何かを足すよう変われば、このテストは緑のまま素通りする。
    #[test]
    fn a_kifu_this_app_just_created_is_never_called_broken() {
        use crate::file_system::spell_for_extension_for_test as spell;

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
                Ok((_, warns)) => {
                    assert!(
                        warns.is_empty(),
                        "{ext}: 直しようの無い警告が出た: {warns:?}"
                    );
                }
                Err(KifuReadError::NothingToIndex { warn }) => {
                    assert!(warn.is_none(), "{ext}: 直しようの無い警告が出た: {warn:?}");
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

    /// 途中で読むのをやめた CSA について、**黙らない**。
    ///
    /// `csa` クレートは読み残しを捨てて `Ok` を返すので、**指し手行の末尾に
    /// 半角スペースが1つ入っただけで、そこから後ろが全部消える**。
    ///
    /// # ヘッダの有無で2軸に割る
    ///
    /// **対局者名を書かない CSA は `says_nothing` の門に掛かる。**
    /// アプリ自身が対局者名なしで作る `.csa` は `V2.2\nPI\n+\n` なので、
    /// その形が1手目で切れると「中身の無い棋譜」と見分けが付かない。
    /// **検査が門より後ろにあると、いちばん失うものが多い形だけが黙る。**
    /// 題材をヘッダあり／なしの2通りで回すのはそのため。
    ///
    /// **戻りを決めるのは [`says_nothing`] だけ**で、読み残しの検査は関わらない。
    /// ヘッダの有無で回すのは、`says_nothing` の門に掛かる側と掛からない側の
    /// **両方で警告が出る**ことを見るため。
    ///
    /// | 題材 | `says_nothing` | 戻り | 局面 | 警告 |
    /// | --- | --- | --- | --- | --- |
    /// | ヘッダあり | 偽（ヘッダが中身） | `Ok` | 入る | 出る |
    /// | ヘッダなし・1手以上読めた | 偽（`moves.len() > 1`） | `Ok` | 入る | 出る |
    /// | ヘッダなし・1手も読めなかった | 真 | `NothingToIndex` | 入らない | 出る |
    ///
    /// **ヘッダなしでも1手読めれば `Ok`**（2手目で切れる／最終行の改行なし が
    /// これに当たる）。ヘッダの有無は戻りを決めていない。
    ///
    /// 題材は**すべて合成**。実在の CSA でこの検査が誤報しないことは確かめていない。
    #[test]
    fn a_csa_that_stops_early_is_warned_about_not_rejected() {
        let dir = temp_dir("csa-cut");
        let whole = "V2.2\nN+山田\nPI\n+\n+7776FU\n-3334FU\n%TORYO\n";
        // アプリが対局者名なしで書き出す形（`try_to_csa_owned` は空のヘッダを書かない）
        let headerless = "V2.2\nPI\n+\n+7776FU\n-3334FU\n%TORYO\n";

        // まず健全な題材が黙って通ることを見る。通らなければ以下の assert は無意味
        for (name, body) in [("ヘッダあり", whole), ("ヘッダなし", headerless)] {
            let ok_path = dir.join(format!("whole-{name}.csa"));
            fs::write(&ok_path, body).expect("書き出し");
            let (jkf, warns) =
                read_path_inner(&ok_path, KifuKind::Csa).expect("健全な CSA が読めること");
            assert_eq!(jkf.moves.len(), 4, "{name}: 題材が想定の手数でない");
            assert!(
                warns.is_empty(),
                "{name}: 健全な CSA に警告が出た: {warns:?}"
            );
        }

        // 読むのをやめさせる壊れ方。どれもクレートは `Ok` を返す。
        // **ヘッダあり／なしの両方で回す** — なし側は `says_nothing` の門に掛かる
        /// 健全な CSA を、クレートが途中で読むのをやめる形に壊す
        type Breakage = (&'static str, &'static dyn Fn(&str) -> String);

        let breakages: [Breakage; 4] = [
            ("1手目の末尾に空白", &|s: &str| {
                s.replace("+7776FU\n", "+7776FU \n")
            }),
            ("2手目の末尾に空白", &|s: &str| {
                s.replace("-3334FU\n", "-3334FU \n")
            }),
            ("手のあとにタブ", &|s: &str| {
                s.replace("+7776FU\n", "+7776FU\t\n")
            }),
            ("最終行の改行が無い", &|s: &str| {
                s.trim_end_matches("%TORYO\n").trim_end().to_owned()
            }),
        ];

        for (base_name, base) in [("ヘッダあり", whole), ("ヘッダなし", headerless)] {
            for (breakage, apply) in &breakages {
                let name = format!("{base_name}/{breakage}");
                let path = dir.join(format!("{name}.csa").replace('/', "_"));
                fs::write(&path, apply(base)).expect("書き出し");

                // 局面が入るかは題材で変わるが、**警告はどちらでも出る**
                let warns = match read_path_inner(&path, KifuKind::Csa) {
                    Ok((_, warns)) => warns,
                    Err(KifuReadError::NothingToIndex { warn }) => warn.into_iter().collect(),
                    Err(e) => panic!("{name}: 読めた記録を断った: {e}"),
                };
                assert_eq!(warns.len(), 1, "{name}: 警告が1件でない: {warns:?}");
                assert!(
                    warns[0].contains("しか読めませんでした"),
                    "{name}: 読み残しを言っていない: {}",
                    warns[0]
                );
                // **利用者に出る文言に Markdown を入れない。** 素のテキストで描かれる
                assert!(
                    !warns[0].contains("**") && !warns[0].contains('`'),
                    "{name}: 文言に記法が混ざっている: {}",
                    warns[0]
                );
            }
        }

        // **読み残しの検査は記録を落とせない。** 落とすかどうかを決めるのは
        // `says_nothing` だけで、駒落ちや盤面図は「中身がある」側に入る。
        // 1手目で切れていても、その初期局面は索引に入れる
        for (name, body) in [
            ("駒落ち", "V2.2\nPI82HI22KA\n-\n-3334FU \n+7776FU\n%TORYO\n"),
            (
                "盤面図",
                "V2.2\nN+山田\nP1 *  *  *  *  * -OU *  *  * \nP2 *  *  *  *  *  *  *  *  * \n\
                 P3 *  *  *  *  *  *  *  *  * \nP4 *  *  *  *  *  *  *  *  * \n\
                 P5 *  *  *  *  *  *  *  *  * \nP6 *  *  *  *  *  *  *  *  * \n\
                 P7 *  *  *  *  *  *  *  *  * \nP8 *  *  *  *  *  *  *  *  * \n\
                 P9 *  *  *  * +OU *  *  *  * \n+\n+5958OU \n-5152OU\n%TORYO\n",
            ),
        ] {
            let path = dir.join(format!("{name}.csa"));
            fs::write(&path, body).expect("書き出し");

            let (jkf, warns) = read_path_inner(&path, KifuKind::Csa)
                .unwrap_or_else(|e| panic!("{name}: 初期局面ごと落とした: {e}"));
            assert!(jkf.initial.is_some(), "{name}: 初期局面が消えている");
            assert_eq!(warns.len(), 1, "{name}: 警告が1件でない: {warns:?}");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 最後まで読めた CSA に、余計な警告を出さない。
    ///
    /// 指し手行を数えるだけだと、**記録が終わったあとの行まで数に入る**。
    /// 2局を1ファイルに置く形（CSA は `/` だけの行で区切る）と、
    /// 感想戦の書き起こしを終局の後ろに置く形が実際にそうなる。
    /// どちらもクレートは1局目を最後まで読めていて、言うことは何も無い。
    ///
    /// **題材が何を固定しているかは1つずつ違う。**
    ///
    /// | 題材 | 黙る理由 |
    /// | --- | --- |
    /// | 2局を連結 / 区切りで分ける | `%` の打ち切り。外すと2局目まで数えて警告が出る |
    /// | 終局の後ろに解説行 | `%` の打ち切り。行の形は指し手だが数に入れない |
    /// | 終局の後ろに指し手の形の行 | **打ち切りに依らない** — クレートもその行を1手として読むので数が揃う |
    /// | special にしない終局のあとに2局目 | `%` の打ち切りだけ。`%TIME_UP` は `special` にならない |
    ///
    /// **4件目は打ち切りを外しても黙る。** そこだけは腕を固定していない。
    /// 5件目に2局目を置いてあるのは、置かないと数が `read` を超えず、
    /// 打ち切りを外しても通ってしまうため（この行が無いと変異が生き残る）。
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

            let (jkf, warns) = read_path_inner(&path, KifuKind::Csa)
                .unwrap_or_else(|e| panic!("{name}: 読めている CSA を断った: {e}"));
            assert!(
                jkf.moves.iter().any(|m| m.move_.is_some()),
                "{name}: 指し手が1つも入っていない"
            );
            assert!(warns.is_empty(), "{name}: 余計な警告が出た: {warns:?}");
        }

        fs::remove_dir_all(&dir).ok();
    }

    /// 数える側と数えられる側が揃っている。**誤報を出さない側を固定する。**
    ///
    /// 指し手ではない行を指し手と数えると、健全な棋譜が「途中で切れている」と
    /// 断られる。CSA のヘッダ・盤面・消費時間・終局・コメントを1つずつ置いて、
    /// どれも数に入らないことを見る。
    #[test]
    fn only_move_lines_are_counted_as_moves() {
        // 数える対象（`+7776FU` の形）
        for line in ["+7776FU", "-3334FU", "+2726FU\r"] {
            assert!(
                is_csa_move_line(line.as_bytes()),
                "指し手行を数えていない: {line:?}"
            );
        }
        // 数えない対象
        for line in [
            "+",
            "-",
            "V2.2",
            "PI",
            "P1-KY-KE",
            "P+00FU",
            "N+山田",
            "$EVENT:研究会",
            "T60",
            "%TORYO",
            "%CHUDAN",
            "'コメント",
            "",
            "+7776F",
            "+777FU",
            "+7776fu",
        ] {
            assert!(
                !is_csa_move_line(line.as_bytes()),
                "指し手行でないものを数えた: {line:?}"
            );
        }
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
