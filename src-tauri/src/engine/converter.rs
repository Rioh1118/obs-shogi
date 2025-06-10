use std::collections::HashMap;
use std::time::Duration;
use usi::{EngineInfo as UsiEngineInfo, InfoParams, ScoreKind};

use super::error::EngineResult;
use super::types::*;

/// USIデータ変換器
#[derive(Debug, Clone)]
pub struct UsiConverter;

impl UsiConverter {
    /// 新しい変換器を作成
    pub fn new() -> Self {
        Self
    }

    /// USIエンジン情報をEngineInfoに変換
    pub fn convert_engine_info(&self, usi_info: &UsiEngineInfo) -> EngineResult<EngineInfo> {
        let name = usi_info.name().to_string();

        // USIのoptions (HashMap<String, String>) を EngineOption のVecに変換
        let options = self.convert_usi_options(usi_info.options());

        Ok(EngineInfo {
            name,
            author: None,
            version: None,
            options,
        })
    }

    /// USIのオプション（HashMap）をEngineOptionのVecに変換
    fn convert_usi_options(&self, usi_options: &HashMap<String, String>) -> Vec<EngineOption> {
        usi_options
            .iter()
            .map(|(name, value)| EngineOption {
                name: name.clone(),
                option_type: EngineOptionType::String {
                    default: Some(value.clone()),
                },
                current_value: Some(value.clone()),
                description: None,
            })
            .collect()
    }

    /// InfoParamsをAnalysisResultに変換
    pub fn convert_info_to_analysis(
        &self,
        info_params: &InfoParams,
    ) -> EngineResult<AnalysisResult> {
        use std::time::{SystemTime, UNIX_EPOCH};

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut result = AnalysisResult {
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
            timestamp,
        };

        match info_params {
            InfoParams::Depth(depth, selective_depth) => {
                result.depth = Some(*depth);
                result.selective_depth = *selective_depth;
            }
            InfoParams::Time(duration) => {
                result.time = Some(duration.as_millis() as u64);
            }
            InfoParams::Nodes(nodes) => {
                result.nodes = Some(*nodes);
            }
            InfoParams::Nps(nps) => {
                result.nps = Some(*nps);
            }
            InfoParams::HashFull(hash_full) => {
                result.hash_full = Some(*hash_full);
            }
            InfoParams::Score(score_value, score_kind) => {
                result.score = Some(self.convert_score(*score_value, score_kind)?);
            }
            InfoParams::Pv(pv) => {
                result.pv = pv.clone();
            }
            InfoParams::CurrMove(current_move) => {
                result.current_move = Some(current_move.clone());
            }
            InfoParams::MultiPv(multi_pv) => {
                result.multi_pv = Some(*multi_pv);
            }
            InfoParams::Text(text) => {
                result.text = Some(text.clone());
            }
        }

        Ok(result)
    }

    /// 複数のInfoParamsを単一のAnalysisResultに統合
    pub fn convert_multi_info_to_analysis(
        &self,
        info_params_list: Vec<InfoParams>,
    ) -> EngineResult<AnalysisResult> {
        use std::time::{SystemTime, UNIX_EPOCH};

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut result = AnalysisResult {
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
            timestamp,
        };

        for info_param in info_params_list {
            match info_param {
                InfoParams::Depth(depth, selective_depth) => {
                    result.depth = Some(depth);
                    result.selective_depth = selective_depth;
                }
                InfoParams::Time(duration) => {
                    result.time = Some(duration.as_millis() as u64);
                }
                InfoParams::Nodes(nodes) => {
                    result.nodes = Some(nodes);
                }
                InfoParams::Nps(nps) => {
                    result.nps = Some(nps);
                }
                InfoParams::HashFull(hash_full) => {
                    result.hash_full = Some(hash_full);
                }
                InfoParams::Score(score_value, score_kind) => {
                    result.score = Some(self.convert_score(score_value, &score_kind)?);
                }
                InfoParams::Pv(pv) => {
                    result.pv = pv;
                }
                InfoParams::CurrMove(current_move) => {
                    result.current_move = Some(current_move);
                }
                InfoParams::MultiPv(multi_pv) => {
                    result.multi_pv = Some(multi_pv);
                }
                InfoParams::Text(text) => {
                    result.text = Some(text);
                }
            }
        }

        Ok(result)
    }

    /// ScoreKindをScoreTypeに変換
    fn convert_score(&self, value: i32, score_kind: &ScoreKind) -> EngineResult<ScoreType> {
        let bound = match score_kind {
            ScoreKind::CpExact | ScoreKind::MateExact => ScoreBound::Exact,
            ScoreKind::CpLowerbound | ScoreKind::MateLowerbound => ScoreBound::Lowerbound,
            ScoreKind::CpUpperbound | ScoreKind::MateUpperbound => ScoreBound::Upperbound,
            ScoreKind::MateSignOnly => ScoreBound::SignOnly,
        };

        let score_type = match score_kind {
            ScoreKind::CpExact | ScoreKind::CpLowerbound | ScoreKind::CpUpperbound => {
                ScoreType::Centipawn { value, bound }
            }
            ScoreKind::MateExact
            | ScoreKind::MateSignOnly
            | ScoreKind::MateLowerbound
            | ScoreKind::MateUpperbound => ScoreType::Mate {
                moves: value,
                bound,
            },
        };

        Ok(score_type)
    }

    /// Duration を秒に変換
    pub fn duration_to_seconds(&self, duration: &Duration) -> f64 {
        duration.as_secs_f64()
    }

    /// Duration をミリ秒に変換（u64）
    pub fn duration_to_millis(&self, duration: &Duration) -> u64 {
        duration.as_millis() as u64
    }

    /// エンジンイベントを作成するヘルパーメソッド
    pub fn create_status_event(&self, status: EngineStatus) -> EngineEvent {
        EngineEvent::StatusChanged { status }
    }

    pub fn create_analysis_event(&self, result: AnalysisResult) -> EngineEvent {
        EngineEvent::AnalysisUpdate { result }
    }

    pub fn create_engine_info_event(&self, info: EngineInfo) -> EngineEvent {
        EngineEvent::EngineInfo { info }
    }

    pub fn create_option_changed_event(&self, name: String, value: Option<String>) -> EngineEvent {
        EngineEvent::OptionChanged { name, value }
    }

    pub fn create_error_event(&self, message: String) -> EngineEvent {
        EngineEvent::Error { message }
    }
}

impl Default for UsiConverter {
    fn default() -> Self {
        Self::new()
    }
}
