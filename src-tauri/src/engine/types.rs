use serde::{Deserialize, Serialize};

/// エンジンオプションの種類
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum EngineOptionType {
    #[serde(rename = "check")]
    Check { default: Option<bool> },
    #[serde(rename = "spin")]
    Spin {
        default: Option<i32>,
        min: Option<i32>,
        max: Option<i32>,
    },
    #[serde(rename = "combo")]
    Combo {
        default: Option<String>,
        choices: Vec<String>,
    },
    #[serde(rename = "button")]
    Button { default: Option<String> },
    #[serde(rename = "string")]
    String { default: Option<String> },
    #[serde(rename = "filename")]
    Filename { default: Option<String> },
}

/// フロントエンド用エンジンオプション
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineOption {
    pub name: String,
    pub option_type: EngineOptionType,
    pub current_value: Option<String>,
    pub description: Option<String>,
}

/// エンジン基本情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub name: String,
    pub author: Option<String>,
    pub version: Option<String>,
    pub options: Vec<EngineOption>,
}

/// エンジン基本情報
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ScoreType {
    #[serde(rename = "cp")]
    Centipawn { value: i32, bound: ScoreBound },
    #[serde(rename = "mate")]
    Mate { moves: i32, bound: ScoreBound },
}

/// 評価値の区間の情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScoreBound {
    #[serde(rename = "exact")]
    Exact,
    #[serde(rename = "lowerbound")]
    Lowerbound,
    #[serde(rename = "upperbound")]
    Upperbound,
    #[serde(rename = "sign_only")]
    SignOnly,
}

/// 解析結果の情報
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub depth: Option<i32>,
    pub selective_depth: Option<i32>,
    pub time: Option<u64>, // milliseconds
    pub nodes: Option<i32>,
    pub nps: Option<i32>,
    pub hash_full: Option<i32>,
    pub score: Option<ScoreType>,
    pub pv: Vec<String>, // 読み筋
    pub current_move: Option<String>,
    pub multi_pv: Option<i32>,
    pub text: Option<String>,
    pub timestamp: u64, // Unix timestamp in milliseconds
}

/// エンジンの状態
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EngineStatus {
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "analyzing")]
    Analyzing,
    #[serde(rename = "error")]
    Error { message: String },
}

/// オプション設定要求
#[derive(Debug, Clone, Deserialize)]
pub struct SetOptionRequest {
    pub name: String,
    pub value: Option<String>,
}

/// 解析開始要求
#[derive(Debug, Clone, Deserialize)]
pub struct StartAnalysisRequest {
    pub position: String, // SFEN format
    pub infinite: bool,
    pub time_limit: Option<u64>, // milliseconds
    pub depth_limit: Option<i32>,
}

/// 解析停止要求
#[derive(Debug, Clone, Deserialize)]
pub struct StopAnalysisRequest {}

/// フロントエンドへの通知イベント
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum EngineEvent {
    #[serde(rename = "status_changed")]
    StatusChanged { status: EngineStatus },
    #[serde(rename = "analysis_update")]
    AnalysisUpdate { result: AnalysisResult },
    #[serde(rename = "engine_info")]
    EngineInfo { info: EngineInfo },
    #[serde(rename = "option_changed")]
    OptionChanged { name: String, value: Option<String> },
    #[serde(rename = "best_move")]
    BestMove {
        best_move: String,
        ponder: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

impl AnalysisResult {
    /// 空の解析結果を作成
    pub fn empty() -> Self {
        Self {
            depth: None,
            selective_depth: None,
            time: None,
            nodes: None,
            nps: None,
            hash_full: None,
            score: None,
            pv: Vec::new(),
            current_move: None,
            multi_pv: None,
            text: None,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        }
    }
}
