//! `engine` のレイヤが共に使う型と、webview へ出す線の形。判断は持たない（`tests/layering.rs` のレイヤ `types`）。
//!
//! serde の欄と変種の綴りは線の名前で、TS の `rust-types.ts` が同じ綴りで読む。
//! 片側だけ変えても型の検査では落ちず、フロントは欄を空として読む。

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// エンジンが `usi` の応答で名乗った名前と作者、宣言した option の定義
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub name: String,
    pub author: String,
    pub options: Vec<EngineOption>,
}

/// エンジンが `usi` の応答で宣言した option 1件の定義。組むのは `option_line::parse_option_line` だけ
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineOption {
    pub name: String,
    pub option_type: EngineOptionType,
    /// 宣言の既定値を文字列にしたもの。`default` の語が無い行と、型に合わない値では `None`
    pub default_value: Option<String>,
    /// 埋める経路が無く、常に `None`
    pub current_value: Option<String>,
}

/// option の型と、型ごとの既定値・範囲。線には外部タグ（`{"Spin": {..}}`）で出る
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EngineOptionType {
    Check {
        default: Option<bool>,
    },
    Spin {
        default: Option<i32>,
        min: Option<i32>,
        max: Option<i32>,
    },
    Combo {
        default: Option<String>,
        vars: Vec<String>,
    },
    Button {
        default: Option<String>,
    },
    String {
        default: Option<String>,
    },
    Filename {
        default: Option<String>,
    },
}

/// 時間切れの目印。`EngineError::Timeout` の文の先頭に置く。
///
/// 先頭にあれば「遅かっただけ」と読める。起動の段階の失敗のうち、再試行で通るものを
/// フロントが見分けられるようにする（`docs/state-transitions/failure-surfacing.md` の F-27）。
/// 返るのはフラットな文字列なので、目印を綴りで持つしかない。
///
/// **部分一致で見ない。** 文字列のどこかに在ることを条件にすると、外から同じ綴りを持ち込める。
/// 対局者の表示名（`failed to start {name}: …` に素で載る）でも、OS の文言（macOS の
/// `ETIMEDOUT` は `Operation timed out`）でも、「遅かっただけ。設定は誤っていない」を名乗れてしまう。
/// そうなると、パスを直す導線（F-27 の唯一の導線）が出ない。
///
/// 保証は片側だけ。先頭に無くても設定の誤りとは言えない。内部の取り落とし（ブロッキングタスクが
/// 落ちた、通知の経路が閉じた）も目印を持たずに届く。同じ断りを `startGame` の TSDoc にも
/// 書いてあるので、片方だけを直さないこと。
///
/// `tests/timeout_marker.rs` が `EngineError::Timeout(` の実引数を走査して、書式の先頭にあることを
/// 要求する。目印は実引数に直接置く。変数へ括り出すと、目印が入っていても落ちる。
pub const TIMED_OUT: &str = "timed out";

/// `setoption` で送る名前と値1件。並べた順にそのまま送る（`setup::checked_prepare`）。
///
/// **`EngineOption` とは別物。** あちらはエンジンが `usi` の応答で宣言してくる option の
/// 定義（型・既定値・現在値）で、向きが逆。同じ綴りにすると、コメントや報告書で
/// 名前を書いた瞬間にどちらか分からなくなる。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetOptionValue {
    pub name: String,
    pub value: String,
}

/// 解析の起動で選んだ定跡（絶対パス）と、解析で使うか
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookChoice {
    pub path: String,
    pub use_in_analysis: bool,
}

/// 起動で送らなかった・変えて送った設定。**起動はできている**（失敗は `StartFailure`）。
/// 画面の文言は種類から組む
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum StartWarning {
    /// このエンジンが申告していない名前。送っていない
    NotDeclared { name: String },
    /// 評価関数・定跡・固定値と同じ名前。そちらを送った
    OverriddenByBinding { name: String },
    /// 範囲の外。`value` に丸めて送った
    Clamped { name: String, value: String },
    /// 選択肢に無い値。送っていない
    NotInVars { name: String, value: String },
    /// 評価関数を指定できないエンジン。送っていない
    EvalNotSupported,
    /// 評価関数を受ける名前（`name`）があるのに選んでいない。エンジンは自分の既定で探す
    EvalNotChosen { name: String },
    /// 評価関数にファイルを要るエンジンに、フォルダを選んでいる。送っていない
    EvalNeedsFile { name: String },
    /// 定跡を指定できないエンジン。送らずに（切れるなら）定跡を切った
    BookNotSupported,
    /// 定跡のファイル名がエンジンの選択肢に無い（名前しか受けないエンジン）。送らずに定跡を切った
    BookNameNotInVars { file: String },
    /// 定跡を受ける名前はあるが、切るオプション（`USI_OwnBook` / `no_book`）が無い。エンジンは自分の
    /// 既定の定跡で指しうる
    BookCannotBeDisabled,
    /// 定跡のファイル名が選択肢に無く、パスを受けるかを確かめたがエンジンが上限までに答えなかった。
    /// 送らずに定跡を切った（名前の問題ではないので `BookNameNotInVars` と分ける）
    BookPathCheckTimedOut { file: String },
    /// 定跡をパスで送ったが、エンジンが「読めない」と言った（`can't read file`）。定跡なしで動いている
    BookNotLoaded { file: String },
    /// 定跡をパスで送ったが、読んだと言わなかった（やねうら王は読むと `read book file : <パス>` を出す）。
    /// 選んだ定跡が使われていない見込みがある
    BookLoadUnconfirmed { file: String },
    /// 申告の型に合わない値（`check` に真偽以外、`spin` に整数以外）。送っていない
    InvalidType { name: String, value: String },
}

/// プリセットに保存するオプションの定義1件。画面に欄を出すためだけに使う（送るときは起動のたびの
/// 申告を見る。`binding::bind`）。
///
/// **線の形（`EngineOption`）とは別に持つ。** あちらの形（外部タグ・snake_case）をそのままファイルに
/// 残すと、線の形を変えるたびにプリセットのファイルの移行が要る。こちらはファイルに残る形なので、
/// 変えるときは版を上げる
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsiOptionDef {
    pub name: String,
    #[serde(flatten)]
    pub kind: UsiOptionKind,
    /// 画面の名前（日本語。`option_labels`）。辞書に無ければ `None`。
    ///
    /// **取得の結果にだけ載せ、プリセットには保存しない**（保存の前に画面が外す）。保存すると、辞書を
    /// 直しても既存のプリセットに届かず、保存する定義の形も変わる
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// 分類（`option_labels`）。`label` と同じく保存しない
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<OptionGroup>,
}

/// オプションの分類。表示だけに使う（送る側は見ない）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OptionGroup {
    /// 定跡の設定（表示側が、定跡を使うかで出し分けるためのフラグ）
    Book,
}

/// 定義の型と、型ごとの既定値・範囲
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UsiOptionKind {
    Check {
        default: Option<bool>,
    },
    Spin {
        default: Option<i32>,
        min: Option<i32>,
        max: Option<i32>,
    },
    Combo {
        default: Option<String>,
        vars: Vec<String>,
    },
    String {
        default: Option<String>,
    },
    Filename {
        default: Option<String>,
    },
    /// 押すだけのオプション。値を持たない（利用者の値の欄を作らない）。定義としては保存する
    Button,
}

impl From<&EngineOption> for UsiOptionDef {
    fn from(option: &EngineOption) -> Self {
        let kind = match &option.option_type {
            EngineOptionType::Check { default } => UsiOptionKind::Check { default: *default },
            EngineOptionType::Spin { default, min, max } => UsiOptionKind::Spin {
                default: *default,
                min: *min,
                max: *max,
            },
            EngineOptionType::Combo { default, vars } => UsiOptionKind::Combo {
                default: default.clone(),
                vars: vars.clone(),
            },
            EngineOptionType::String { default } => UsiOptionKind::String {
                default: default.clone(),
            },
            EngineOptionType::Filename { default } => UsiOptionKind::Filename {
                default: default.clone(),
            },
            EngineOptionType::Button { .. } => UsiOptionKind::Button,
        };
        Self {
            name: option.name.clone(),
            kind,
            label: None,
            group: None,
        }
    }
}

/// エンジンの申告を取った結果（`probe_engine`）。`token` と `engine_path` は受けたものをそのまま返す——
/// 画面は、いまの取得・いまのパスのものでなければ捨てる
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeOutcome {
    pub token: u64,
    pub engine_path: String,
    pub name: String,
    pub author: String,
    /// 申告の順
    pub definitions: Vec<UsiOptionDef>,
    /// 評価関数・定跡・固定値が持つ名前（`binding::reserved_names`）。利用者の値としては送らない
    pub reserved: Vec<String>,
}

/// 選択肢（combo）で申告した定跡の名前が、選択肢に無い値をパスとして受けるか。**起こしたプロセスに
/// 確かめた結果**（`setup::check_book_path_support`）。申告からは分からない——やねうら王 V8.30 と V9.00 は定跡の
/// 申告が同じで、V8.30 はパスを読み、V9.00 は捨てて既定の定跡に落ちる
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BookPathSupport {
    /// 確かめていない（確かめる要が無かった）。受けない扱い
    #[default]
    Unchecked,
    Accepts,
    Rejects,
    /// 上限までに答えなかった。受けない扱い（別の定跡で動くより、切るほうが安全）
    NoAnswer,
}

/// 解析の起動が返すもの。警告は起動を止めない
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOutcome {
    pub info: EngineInfo,
    pub warnings: Vec<StartWarning>,
}

/// エンジンを起動できなかった理由の種類。**画面の文言はこれから組む**
/// （エンジンが書いた文字列は `StartFailure::message` の側にしか載せない）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartFailureKind {
    /// OS が起動させなかった（パスが無い、実行権限が無い、など）
    SpawnFailed,
    /// macOS が開くのをまだ許可していない（`engine::launchable`）
    Quarantined,
    /// 起動したが `usi` に `usiok` で答えなかったか、名乗らなかった。USI エンジンではない見込み
    NotUsi,
    /// 使える状態になる前に出力が終わった・書き込めなくなった。評価関数・共有ライブラリの
    /// 失敗が多い（`usiok` の前に終わったものも含む）
    ExitedEarly,
    /// 締切までに段階が終わらなかった
    TimedOut,
    /// 送る前に断った値（件数・長さ・行を壊す文字。利用者の値と評価関数・定跡のパス。`setup::validate_options`）。
    /// 型の合わない値は断らずに送らない（`StartWarning::InvalidType`）
    InvalidValue,
    /// こちらが止めた（起動中に別の設定へ切り替えた、利用者が起動をやめた）。フロントは
    /// 自分が別の要求で止めた回を世代で捨てるので、帯に届くのは利用者がやめた回だけ
    Cancelled,
    Other,
}

/// エンジンを起動できなかったこと。画面の文言は `kind` から組み、`message` はログにだけ使う。
///
/// `message` と `last_output` はエンジンの出力を含みうるので、長さを切り、制御文字を潰してある
/// （`start_failure::classify`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFailure {
    pub kind: StartFailureKind,
    pub message: String,
    /// エンジンが最後に出した行。無ければ `None`
    pub last_output: Option<String>,
}

/// `EngineError` を、フロントへ返す1本の文字列にする。
///
/// **時間切れだけは包まない。** `Display` は `Operation timeout: …` を前置するので、
/// 素で文字列にすると `TIMED_OUT` が先頭から外れる。中身は必ず目印で始まる
/// （`tests/timeout_marker.rs` が要求する）ので、そのまま返せばよい。
pub fn engine_error_text(error: &EngineError) -> String {
    match error {
        EngineError::Timeout(why) => why.clone(),
        EngineError::NotInitialized(_)
        | EngineError::StartupFailed(_)
        | EngineError::CommunicationFailed(_)
        | EngineError::InvalidState(_)
        | EngineError::Cancelled(_) => error.to_string(),
    }
}

/// エンジンの起動とやりとりの失敗。`Display` は種類ごとの定型文を前置する
/// （時間切れだけは前置を外して返す。`engine_error_text`）
#[derive(Error, Debug)]
pub enum EngineError {
    #[error("Engine not initialized: {0}")]
    NotInitialized(String),
    #[error("Engine startup failed: {0}")]
    StartupFailed(FailureDetail<StartupReason>),
    #[error("Communication failed: {0}")]
    CommunicationFailed(FailureDetail<String>),
    #[error("Invalid engine state: {0}")]
    InvalidState(String),
    #[error("Operation timeout: {0}")]
    Timeout(String),
    /// こちらが止めた。起動中の取り消しや、待っている最中の kill
    #[error("Cancelled: {0}")]
    Cancelled(String),
}

/// `usi` に `usiok` で答えなかったときの断り文句の頭（`StartupReason::NoUsiOk` の綴り）
pub const NO_USIOK: &str = "the engine did not answer `usi` with `usiok`";

/// `usiok` までに `id name` が無かったときの断り文句（`StartupReason::NoIdName` の綴り）
pub const NO_ID_NAME: &str = "the engine did not send `id name` before `usiok`";

/// 失敗の文へ直近の出力を添える綴り（`FailureDetail` の `Display`）
pub const LAST_OUTPUT_PREFIX: &str = " (last output: ";

/// 失敗の理由と、そのときエンジンが最後に出した行。
///
/// **2つを別の欄で持つ。** 1本の文字列に繋ぐと、分類する側（`start_failure::classify`）は
/// 綴りで切り出し直すしかなく、文言を変えても型の検査では落ちずに分類だけが変わる。
/// `Display` は繋いだ綴り（`{理由} (last output: {出力})`）で、フロントへ出る文はこれまでと同じ
#[derive(Debug)]
pub struct FailureDetail<R> {
    pub reason: R,
    /// エンジンが最後に出した行を1行にまとめたもの。添えるのは `protocol.rs` の `Handle::with_recent_output` だけ
    pub last_output: Option<String>,
}

impl<R: std::fmt::Display> std::fmt::Display for FailureDetail<R> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.reason)?;
        if let Some(output) = &self.last_output {
            write!(f, "{LAST_OUTPUT_PREFIX}{output})")?;
        }
        Ok(())
    }
}

impl<R> From<R> for FailureDetail<R> {
    fn from(reason: R) -> Self {
        Self {
            reason,
            last_output: None,
        }
    }
}

impl From<String> for FailureDetail<StartupReason> {
    fn from(text: String) -> Self {
        StartupReason::Other(text).into()
    }
}

impl From<&str> for FailureDetail<StartupReason> {
    fn from(text: &str) -> Self {
        text.to_string().into()
    }
}

impl From<&str> for FailureDetail<String> {
    fn from(text: &str) -> Self {
        text.to_string().into()
    }
}

/// 起動の失敗の理由。**利用者の次の手が変わるものだけを変種にする。**
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupReason {
    /// `usi` に `waited` の間 `usiok` で答えなかった。満額の `USI_OK_TIMEOUT` を待った回なら、
    /// そのファイルは USI エンジンではない。削った上限で待った回は「待つ時間が残っていない」
    /// （読み直すのは呼び手。`game/start.rs` の `usiok_refusal`）
    NoUsiOk { waited: std::time::Duration },
    /// 答えはしたが `usiok` までに名乗らなかった。分類は `NoUsiOk` と同じ側
    NoIdName,
    /// 起こせなかった（パス、権限、起動のタスク）。文はそのまま見せる
    Other(String),
}

impl std::fmt::Display for StartupReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoUsiOk { waited } => write!(
                f,
                "{NO_USIOK} in {waited:?}; the file may not be a USI engine"
            ),
            Self::NoIdName => f.write_str(NO_ID_NAME),
            Self::Other(text) => f.write_str(text),
        }
    }
}

/// 走っている解析1件の状態（`get_analysis_status`）。`elapsed_time` と `config` は埋める経路が無く、
/// 常に `None`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisStatus {
    pub is_analyzing: bool,
    pub session_id: Option<String>,
    pub elapsed_time: Option<Duration>,
    pub config: Option<AnalysisConfig>,
    pub analysis_count: u64,
}

/// 解析の打ち切りの設定。組む経路が無い（`AnalysisStatus::config` は常に `None`）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisConfig {
    pub time_limit: Option<Duration>,
    pub depth_limit: Option<u32>,
    pub node_limit: Option<u64>,
    pub mate_search: bool,
    pub multi_pv: Option<u32>,
}

/// 線に出す経過時間。`std::time::Duration` とは別物
///
/// 同名なのは、TypeScript 側に `{ secs, nanos }` として出る形をそのまま
/// 名前にしているため。
///
/// **グロブで取り込むファイルは、頭で `use std::time::Duration;` も書くこと。**
/// 明示 import はグロブより優先されるので、その1行で `Duration` は常に
/// `std` のほうを指す。線に出すこちらを使うときだけ `types::Duration` と書く。
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Duration {
    pub secs: u64,
    pub nanos: u32,
}

impl From<std::time::Duration> for Duration {
    fn from(d: std::time::Duration) -> Self {
        Self {
            secs: d.as_secs(),
            nanos: d.subsec_nanos(),
        }
    }
}

/// 読み筋1本の評価値。`value` の読み方は `kind` で変わる
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evaluation {
    pub value: i32,
    pub kind: EvaluationKind,
}

/// 評価値の読み方。上界・下界のフラグ（`lowerbound` / `upperbound`）は区別しない
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvaluationKind {
    /// `score cp`。`value` は centipawn
    Centipawn,

    /// `score mate <n>`。`value` と中身は、エンジンが書いた手数を符号ごとそのまま持つ
    MateInMoves(i32),

    /// `score mate +` / `score mate -`。手数が分からない詰み。真が `+` で、`value` は 1 か -1
    MateUnknown(bool),
}

/// 1回の探索の読み筋。`candidates` は `rank` の昇順（`candidates::apply_info_params` が並べる）
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub candidates: Vec<AnalysisCandidate>,

    /// `go mate` にエンジンが `checkmate` で答えた詰み手順。詰まない、調べられなかった答えは空。
    /// `score mate` とは別物
    pub mate_sequence: Option<Vec<String>>,
}

/// MultiPV の読み筋1本。欄はどれも、その `rank` の `info` で最後に受けた値
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisCandidate {
    /// MultiPV の番号。`multipv` の無い `info` は 1 に入る
    pub rank: u32,

    /// `pv_line` の先頭
    pub first_move: Option<String>,

    /// 読み筋（USI の指し手の綴り）
    pub pv_line: Vec<String>,

    pub evaluation: Option<Evaluation>,

    /// `depth`。`seldepth` は捨てる
    pub depth: Option<u32>,

    pub nodes: Option<u64>,

    /// `time`（ミリ秒）
    pub time_ms: Option<u64>,
}

/// 解析の結果の通知。**`session_id` を載せるのは、受け手が自分のものか照合するため。**
///
/// 前の解析の通知は、次の解析を始めた後にも着きうる（通知は解析のタスクから非同期に出る）。
/// 照合しないと、前の局面の読み筋が現在の盤面の解析結果として画面に出る。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisUpdate {
    pub session_id: String,
    pub result: AnalysisResult,
}

/// エンジンが自分で終わったことの通知。
///
/// `request` はそのプロセスを起動した要求の番号（`analyzer::Request`）。受け手は最後に撃った
/// 番号と照合する。起動し直している最中に届く古いプロセスの終わりで、
/// 新しい起動を「終わった」と読まないため
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineExited {
    pub request: u64,
    /// エンジンが最後に出した行の要約（`protocol::summarize_recent`。stderr を先に最大3行）
    pub last_output: Option<String>,
}

/// エンジンに指示が通らなくなった理由
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UnresponsiveReason {
    /// `stop` に `ANALYSIS_STOP_GRACE` を超えて答えない
    NoAnswer,
    /// stdin を読まなくなった
    Unwritable,
}

/// エンジンに指示が通らなくなったことの通知。`request` は `EngineExited` と同じ
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineUnresponsive {
    pub request: u64,
    pub reason: UnresponsiveReason,
    /// エンジンが最後に出した行
    pub last_output: Option<String>,
}

/// `stop` に遅れて答えがあった通知。`request` は `EngineExited` と同じ
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineAnswered {
    pub request: u64,
}

/// 停止の結末。**`Unanswered` は失敗ではない。** 席は空いていて、探索がまだ終わっていない
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopOutcome {
    Stopped,
    Unanswered,
}

/// 深度指定の解析が返すもの。
///
/// **`AnalysisResult` だけを返さない。** 返すと「届かなかった」が消え、
/// 深度22の結果が深度40の解析として読まれる。呼び出し側に見分ける手段が要る。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthOutcome {
    pub result: AnalysisResult,
    /// 要求した深度
    pub requested: u32,
    /// 実際に届いた深度（`info depth` の最善手のもの）。`info` が1行も
    /// 来なければ `None`
    pub deepest: Option<u32>,
    /// `requested` に届いたか
    pub reached: bool,
}

/// 無限解析を始められなかった理由。**`unreachable` で次の手が分かれる。**
///
/// エンジンへ書けなかった回は `応答なし` へ入り、検討の意思が残る。席が埋まっている、局面が無い、
/// といった断りは、やり直しても同じなので断りの文を出す
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartRefusal {
    pub unreachable: bool,
    pub message: String,
}

/// プロセスとの繋がりがどう終わったか
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineEnd {
    /// こちらが落とした（`quit` か `kill_engine`）
    Requested,
    /// こちらが落としていないのに出力が終わった
    Exited,
    /// stdin を読まなくなった。**プロセスは残っている**
    Stalled,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 時間切れの目印が、文字列にしたときも**先頭**に残ること。
    ///
    /// `Display` は `Operation timeout: …` を前置するので、素で文字列にすると
    /// 目印が中へ潜る。潜ると、フロントは部分一致で見るしかなくなり、
    /// 対局者の表示名や OS の文言（macOS の `ETIMEDOUT` は `Operation timed out`）に
    /// 同じ綴りが入っただけで「遅かっただけ。設定は誤っていない」を名乗れる。
    #[test]
    fn a_timeout_keeps_the_marker_at_the_front() {
        let text = engine_error_text(&EngineError::Timeout(format!(
            "{TIMED_OUT} waiting for usiok"
        )));
        assert!(text.starts_with(TIMED_OUT), "目印が先頭に無い: {text}");

        // 時間切れ以外は名乗らない
        let other = engine_error_text(&EngineError::StartupFailed(
            "engine_path must point to an existing file"
                .to_string()
                .into(),
        ));
        assert!(
            !other.starts_with(TIMED_OUT),
            "時間切れでない失敗が目印を名乗っている: {other}"
        );
    }

    /// 理由と直近の出力を別の欄で持っても、`Display` の綴りは1本の文字列だったときと同じ。
    /// フロントへ出る文（`engine_error_text`）と、ログを読む人が探す綴りを変えない
    #[test]
    fn a_failure_detail_reads_as_the_old_single_string() {
        let text = |error: EngineError| engine_error_text(&error);
        assert_eq!(
            text(EngineError::StartupFailed(
                StartupReason::NoUsiOk {
                    waited: std::time::Duration::from_secs(30)
                }
                .into()
            )),
            format!("Engine startup failed: {NO_USIOK} in 30s; the file may not be a USI engine")
        );
        assert_eq!(
            text(EngineError::StartupFailed(FailureDetail {
                reason: StartupReason::NoIdName,
                last_output: Some("stderr: boom".to_string()),
            })),
            format!("Engine startup failed: {NO_ID_NAME} (last output: stderr: boom)")
        );
        assert_eq!(
            text(EngineError::StartupFailed(
                "Failed to spawn engine: denied".into()
            )),
            "Engine startup failed: Failed to spawn engine: denied"
        );
        assert_eq!(
            text(EngineError::CommunicationFailed(FailureDetail {
                reason: "engine exited before it became ready".to_string(),
                last_output: Some("info string bye".to_string()),
            })),
            "Communication failed: engine exited before it became ready (last output: info string bye)"
        );
    }

    /// 経過時間は秒と端数のナノ秒に分けて線へ出す
    #[test]
    fn a_duration_keeps_seconds_and_nanos() {
        let wire = Duration::from(std::time::Duration::new(3, 250_000_000));
        assert_eq!((wire.secs, wire.nanos), (3, 250_000_000));
    }

    /// 応答しない理由の綴りは線の名前。TS（`entities/engine` の `UnresponsiveReason`）が同じ綴りで読む
    #[test]
    fn unresponsive_reasons_are_spelled_for_the_wire() {
        assert_eq!(
            serde_json::to_value(UnresponsiveReason::NoAnswer).expect("書ける"),
            "noAnswer"
        );
        assert_eq!(
            serde_json::to_value(UnresponsiveReason::Unwritable).expect("書ける"),
            "unwritable"
        );
    }
}
