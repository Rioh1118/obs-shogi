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

// 分析設定
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisConfig {
    pub time_limit: Option<Duration>,
    pub depth_limit: Option<u32>,
    pub node_limit: Option<u64>,
    pub mate_search: bool,
    pub multi_pv: Option<u32>,
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
