use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub name: String,
    pub author: String,
    pub options: Vec<EngineOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineOption {
    pub name: String,
    pub option_type: EngineOptionType,
    pub default_value: Option<String>,
    pub current_value: Option<String>,
}

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

/// 時間切れの目印。**先頭に置く。**
///
/// **先頭にあれば「遅かっただけ」。** 起動段の失敗のうち、再試行で通るものを
/// フロントが見分けられるようにする（→ `failure-surfacing.md` の F-27）。
/// 返るのはフラットな文字列なので、目印を綴りで持つしかない。
///
/// **部分一致で見ない。** 文字列のどこかに在ることを条件にすると、
/// 外から同じ綴りを持ち込める——対局者の表示名（`failed to start {name}: …` に
/// 素で載る）でも、OS の文言（macOS の `ETIMEDOUT` は `Operation timed out`）でも、
/// 「遅かっただけ。設定は誤っていない」を名乗れてしまう。
/// そうなると、パスを直す導線（F-27 の唯一の導線）が出ない。
///
/// **片側だけの保証。** 先頭に無ければ設定の誤り、とは言えない——
/// 内部の取り落とし（ブロッキングタスクが落ちた、通知の経路が閉じた）も
/// 目印を持たずに届く。断言しているのは `startGame` の TSDoc ではなく
/// ここだけ、という状態にしないこと。
///
/// `tests/timeout_marker.rs` が `EngineError::Timeout(` の実引数を走査して、
/// **書式の先頭にあること**を要求する。
/// **実引数に直接置くこと**——変数へ括り出すと、目印が入っていても落ちる。
pub const TIMED_OUT: &str = "timed out";

/// `setoption` で送る値1件。**並べた順にそのまま送る**（`setup::send_setup`）。
///
/// **`EngineOption` とは別物。** あちらはエンジンが `usi` の応答で宣言してくる option の
/// **定義**（型・既定値・現在値）で、向きが逆。同じ綴りにすると、コメントや報告書で
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
    /// 定跡を受ける名前はあるが、切る口（`USI_OwnBook` / `no_book`）が無い。エンジンは自分の
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

/// プリセットに**保存する**オプションの定義1件。画面に欄を出すためだけに使う（送るときは起動のたびの
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
    /// 画面の名前（日本語。`option_labels`）。辞書に無ければ `None` で、画面はエンジンの綴りのまま出す
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// 分類（`option_labels`）。定跡を使わないとき、画面は `Book` を隠す
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<OptionGroup>,
}

/// オプションの分類。表示だけに使う（送る側は見ない）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OptionGroup {
    /// 定跡の設定
    Book,
    /// 対局の持ち時間まわり（解析では効かない）
    Match,
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
    /// 押すだけの口。値を持たない（利用者の値の欄を作らない）。定義としては保存する
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
/// 確かめた結果**（`setup::accepts_path_in`）。申告からは分からない——やねうら王 V8.30 と V9.00 は定跡の
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
    /// 締切までに段が終わらなかった
    TimedOut,
    /// 送る前に断った値（件数・長さ・行を壊す文字。利用者の値と評価関数・定跡のパス。`setup::validate_options`）。
    /// 型の合わない値は断らずに送らない（`StartWarning::InvalidType`）
    InvalidValue,
    /// こちらが止めた（起動中に別の設定へ切り替えた、利用者が起動をやめた）。フロントは
    /// 自分が別の要求で止めた回を世代で捨てるので、帯に届くのは利用者がやめた回だけ
    Cancelled,
    Other,
}

/// エンジンを起動できなかったこと。`message` はログにだけ使う（画面の文言は `kind` から組む）
/// （エンジンの出力を含むことがある。長さと制御文字は落としてある）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFailure {
    pub kind: StartFailureKind,
    pub message: String,
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
        | EngineError::ProtocolViolation(_)
        | EngineError::AnalysisFailed(_)
        | EngineError::AlreadyListening(_)
        | EngineError::Cancelled(_) => error.to_string(),
    }
}

#[derive(Error, Debug)]
pub enum EngineError {
    #[error("Engine not initialized: {0}")]
    NotInitialized(String),
    #[error("Engine startup failed: {0}")]
    StartupFailed(String),
    #[error("Communication failed: {0}")]
    CommunicationFailed(String),
    #[error("Invalid engine state: {0}")]
    InvalidState(String),
    #[error("USI protocol violation: {0}")]
    ProtocolViolation(String),
    #[error("Operation timeout: {0}")]
    Timeout(String),
    #[error("Analysis failed: {0}")]
    AnalysisFailed(String),
    #[error("Already listening: {0}")]
    AlreadyListening(String),
    /// こちらが止めた。起動中の取り消しや、待っている最中の kill
    #[error("Cancelled: {0}")]
    Cancelled(String),
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
            "engine_path must point to an existing file".to_string(),
        ));
        assert!(
            !other.starts_with(TIMED_OUT),
            "時間切れでない失敗が目印を名乗っている: {other}"
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisStatus {
    pub is_analyzing: bool,
    pub session_id: Option<String>,
    pub elapsed_time: Option<Duration>,
    pub config: Option<AnalysisConfig>,
    pub analysis_count: u64,
}

// 分析設定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisConfig {
    pub time_limit: Option<Duration>,
    pub depth_limit: Option<u32>,
    pub node_limit: Option<u64>,
    pub mate_search: bool,
    pub multi_pv: Option<u32>,
}

/// 線に出す経過時間。**`std::time::Duration` とは別物。**
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evaluation {
    pub value: i32,
    pub kind: EvaluationKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvaluationKind {
    /// score cp <value>
    Centipawn,

    /// score mate <n> / mate lowerbound/upperbound の数値が取れるケース
    /// value は engine が返した整数をそのまま入れる（符号含む）
    MateInMoves(i32),

    /// score mate + / score mate - のように距離が不明なケース
    /// true = '+', false = '-'
    MateUnknown(bool),
}

/// 解析結果
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub candidates: Vec<AnalysisCandidate>,

    /// go mate を使った時に engine が checkmate コマンドで返す詰み手順
    /// score mate とは別物
    pub mate_sequence: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisCandidate {
    pub rank: u32,

    /// PVの先頭（あれば便利）: pv_line[0]
    pub first_move: Option<String>,

    /// PV全体（USI move文字列の配列）
    pub pv_line: Vec<String>,

    /// cp/mate を統一表現
    pub evaluation: Option<Evaluation>,

    /// depth/seldepth 等を入れたいなら拡張しやすい形
    pub depth: Option<u32>,

    /// nodes は rankごとに異なる場合もあるが、まずは入れておく
    pub nodes: Option<u64>,

    /// time は info time を受けるたび更新される
    pub time_ms: Option<u64>,
}
