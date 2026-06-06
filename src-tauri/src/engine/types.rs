use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineSettings {
    pub options: HashMap<String, String>,
}

impl EngineSettings {
    pub fn new() -> Self {
        Self {
            options: HashMap::new(),
        }
    }

    pub fn set_option(&mut self, name: &str, value: &str) {
        self.options.insert(name.to_string(), value.to_string());
    }

    pub fn get_option(&self, name: &str) -> Option<&String> {
        self.options.get(name)
    }
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self::new()
    }
}

/// エンジン状態情報
#[derive(Debug, Clone)]
pub struct EngineStatus {
    pub is_initialized: bool,
    pub is_ready: bool,
    pub engine_path: Option<String>,
    pub work_dir: Option<String>,
    pub restart_count: u32,
    pub listener_count: usize,
}

/// ヘルスチェック結果
#[derive(Debug, Clone)]
pub struct HealthCheckResult {
    pub is_healthy: bool,
    pub message: String,
    pub details: Option<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisStatus {
    pub is_analyzing: bool,
    pub session_id: Option<String>,
    pub elapsed_time: Option<Duration>,
    pub config: Option<AnalysisConfig>,
    pub analysis_count: u64,
}

/// 解析の停止条件。これが「解析設定」の全て — 他の解析オプション（MultiPV など）は
/// `apply_engine_settings` 経由の USI options に集約されている。
///
/// variant 名が serde tag `mode` を兼ねる。新しい停止条件を増やすときは variant を追加し、
/// `should_stop_on_info` / `handle_bestmove` / `mode_tag` を更新する。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum AnalysisConfig {
    #[default]
    Infinite,
    Time {
        #[serde(rename = "timeSeconds")]
        seconds: u64,
    },
    Depth {
        #[serde(rename = "depth")]
        plies: u32,
    },
    Nodes {
        #[serde(rename = "nodes")]
        count: u64,
    },
    Mate,
}

/// bestmove を受け取ったときの処理方針。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BestmoveAction {
    /// engine 自然終了。bestmove で stream 終了。
    Finish,
    /// 外部 stop を待っているモード（Infinite）。stop フラグが立つまでは stale として無視。
    IgnoreUnlessStopped,
}

impl AnalysisConfig {
    pub fn mode_tag(&self) -> &'static str {
        match self {
            Self::Infinite => "infinite",
            Self::Time { .. } => "time",
            Self::Depth { .. } => "depth",
            Self::Nodes { .. } => "nodes",
            Self::Mate => "mate",
        }
    }

    /// rank 1 candidate の閾値が達したら true。閾値モードのみ意味を持つ。
    pub fn should_stop_on_info(&self, result: &AnalysisResult) -> bool {
        match self {
            Self::Depth { plies } => result
                .candidates
                .iter()
                .find(|c| c.rank == 1)
                .and_then(|c| c.depth)
                .is_some_and(|d| d >= *plies),
            Self::Nodes { count } => result
                .candidates
                .iter()
                .find(|c| c.rank == 1)
                .and_then(|c| c.nodes)
                .is_some_and(|n| n >= *count),
            _ => false,
        }
    }

    pub fn handle_bestmove(&self) -> BestmoveAction {
        match self {
            Self::Infinite => BestmoveAction::IgnoreUnlessStopped,
            _ => BestmoveAction::Finish,
        }
    }
}

// 最善手情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InitializeEngineResponse {
    pub engine_info: EngineInfo,
    pub success: bool,
}

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

#[cfg(test)]
mod analysis_config_tests {
    use super::*;

    fn candidate_with(rank: u32, depth: Option<u32>, nodes: Option<u64>) -> AnalysisCandidate {
        AnalysisCandidate {
            rank,
            first_move: None,
            pv_line: vec![],
            evaluation: None,
            depth,
            nodes,
            time_ms: None,
        }
    }

    fn result_with(candidates: Vec<AnalysisCandidate>) -> AnalysisResult {
        AnalysisResult {
            candidates,
            mate_sequence: None,
        }
    }

    #[test]
    fn mode_tag_returns_lowercase_variant_name() {
        assert_eq!(AnalysisConfig::Infinite.mode_tag(), "infinite");
        assert_eq!(AnalysisConfig::Time { seconds: 5 }.mode_tag(), "time");
        assert_eq!(AnalysisConfig::Depth { plies: 5 }.mode_tag(), "depth");
        assert_eq!(AnalysisConfig::Nodes { count: 5 }.mode_tag(), "nodes");
        assert_eq!(AnalysisConfig::Mate.mode_tag(), "mate");
    }

    #[test]
    fn handle_bestmove_finishes_for_non_infinite() {
        assert_eq!(
            AnalysisConfig::Time { seconds: 1 }.handle_bestmove(),
            BestmoveAction::Finish
        );
        assert_eq!(
            AnalysisConfig::Depth { plies: 1 }.handle_bestmove(),
            BestmoveAction::Finish
        );
        assert_eq!(
            AnalysisConfig::Nodes { count: 1 }.handle_bestmove(),
            BestmoveAction::Finish
        );
        assert_eq!(AnalysisConfig::Mate.handle_bestmove(), BestmoveAction::Finish);
    }

    #[test]
    fn handle_bestmove_for_infinite_waits_for_stop() {
        assert_eq!(
            AnalysisConfig::Infinite.handle_bestmove(),
            BestmoveAction::IgnoreUnlessStopped
        );
    }

    #[test]
    fn should_stop_on_info_for_depth_when_reached() {
        let cfg = AnalysisConfig::Depth { plies: 10 };
        let r = result_with(vec![candidate_with(1, Some(10), None)]);
        assert!(cfg.should_stop_on_info(&r));
    }

    #[test]
    fn should_stop_on_info_for_depth_not_reached() {
        let cfg = AnalysisConfig::Depth { plies: 10 };
        let r = result_with(vec![candidate_with(1, Some(9), None)]);
        assert!(!cfg.should_stop_on_info(&r));
    }

    #[test]
    fn should_stop_on_info_for_depth_uses_rank1_only() {
        // rank 2 が閾値に達しても rank 1 が達していなければ false
        let cfg = AnalysisConfig::Depth { plies: 10 };
        let r = result_with(vec![
            candidate_with(1, Some(5), None),
            candidate_with(2, Some(20), None),
        ]);
        assert!(!cfg.should_stop_on_info(&r));
    }

    #[test]
    fn should_stop_on_info_for_nodes_when_reached() {
        let cfg = AnalysisConfig::Nodes { count: 100_000 };
        let r = result_with(vec![candidate_with(1, None, Some(100_000))]);
        assert!(cfg.should_stop_on_info(&r));
    }

    #[test]
    fn should_stop_on_info_for_nodes_not_reached() {
        let cfg = AnalysisConfig::Nodes { count: 100_000 };
        let r = result_with(vec![candidate_with(1, None, Some(99_999))]);
        assert!(!cfg.should_stop_on_info(&r));
    }

    #[test]
    fn should_stop_on_info_false_for_non_threshold_modes() {
        let r = result_with(vec![candidate_with(1, Some(99), Some(99_999_999))]);
        assert!(!AnalysisConfig::Infinite.should_stop_on_info(&r));
        assert!(!AnalysisConfig::Time { seconds: 1 }.should_stop_on_info(&r));
        assert!(!AnalysisConfig::Mate.should_stop_on_info(&r));
    }

    #[test]
    fn serde_roundtrip_time() {
        let cfg = AnalysisConfig::Time { seconds: 30 };
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(json, r#"{"mode":"time","timeSeconds":30}"#);
        let back: AnalysisConfig = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, AnalysisConfig::Time { seconds: 30 }));
    }

    #[test]
    fn serde_roundtrip_depth() {
        let cfg = AnalysisConfig::Depth { plies: 20 };
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(json, r#"{"mode":"depth","depth":20}"#);
    }

    #[test]
    fn serde_roundtrip_nodes() {
        let cfg = AnalysisConfig::Nodes { count: 1_000_000 };
        let json = serde_json::to_string(&cfg).unwrap();
        assert_eq!(json, r#"{"mode":"nodes","nodes":1000000}"#);
    }

    #[test]
    fn serde_roundtrip_bare_variants() {
        assert_eq!(
            serde_json::to_string(&AnalysisConfig::Infinite).unwrap(),
            r#"{"mode":"infinite"}"#
        );
        assert_eq!(
            serde_json::to_string(&AnalysisConfig::Mate).unwrap(),
            r#"{"mode":"mate"}"#
        );
    }
}
