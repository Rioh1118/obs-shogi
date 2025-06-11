use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct AnalysisResult {
    pub evaluation: Option<Evaluation>,
    pub principal_variations: Vec<PrincipalVariation>,
    pub depth_info: Option<DepthInfo>,
    pub search_stats: Option<SearchStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evaluation {
    pub value: i32,
    pub kind: EvaluationKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EvaluationKind {
    Centipawn,
    MateInMoves(i32),
    MateUnknown(bool),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrincipalVariation {
    pub line_number: Option<i32>, // Multi PV番号
    pub moves: Vec<String>,
    pub evaluation: Option<Evaluation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepthInfo {
    pub depth: i32,
    pub selective_depth: Option<i32>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct SearchStats {
    pub nodes: Option<i32>,
    pub nps: Option<i32>,
    pub hash_full: Option<i32>,
    pub time_elapsed: Option<Duration>,
}

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
