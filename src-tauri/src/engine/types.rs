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
    /// 送る前に断った `setoption`（件数・長さ・行を壊す文字。`setup::validate_options`）
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
