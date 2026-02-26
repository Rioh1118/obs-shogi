use std::time::{Duration, Instant};
use usi::{GuiCommand, InfoParams, ScoreKind};

use crate::engine::types::{AnalysisCandidate, AnalysisResult, Evaluation, EvaluationKind};

pub fn get_depth_of_rank(result: &AnalysisResult, rank: u32) -> Option<u32> {
    result
        .candidates
        .iter()
        .find(|c| c.rank == rank)
        .and_then(|c| c.depth)
}

pub fn extract_rank(info_params: &[InfoParams]) -> u32 {
    for info in info_params {
        if let InfoParams::MultiPv(r) = info {
            return *r as u32;
        }
    }
    1
}

pub fn get_or_create_candidate(result: &mut AnalysisResult, rank: u32) -> &mut AnalysisCandidate {
    if let Some(idx) = result.candidates.iter().position(|c| c.rank == rank) {
        return &mut result.candidates[idx];
    }

    result.candidates.push(AnalysisCandidate {
        rank,
        first_move: None,
        pv_line: Vec::new(),
        evaluation: None,
        depth: None,
        nodes: None,
        time_ms: None,
    });

    let last = result.candidates.len() - 1;
    &mut result.candidates[last]
}

pub fn map_score_to_evaluation(value: i32, kind: &ScoreKind) -> Evaluation {
    match kind {
        ScoreKind::CpExact | ScoreKind::CpLowerbound | ScoreKind::CpUpperbound => Evaluation {
            value,
            kind: EvaluationKind::Centipawn,
        },

        ScoreKind::MateExact | ScoreKind::MateLowerbound | ScoreKind::MateUpperbound => {
            Evaluation {
                value,
                kind: EvaluationKind::MateInMoves(value),
            }
        }

        ScoreKind::MateSignOnly => {
            // usi crate 側の value が +1/-1 か 0/+0 かは実装依存になりがちなので、
            // 「0以上を+扱い」に寄せておくのが安全
            let plus = value >= 0;
            Evaluation {
                value: if plus { 1 } else { -1 },
                kind: EvaluationKind::MateUnknown(plus),
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct LogThrottle {
    interval: Duration,
    last: Instant,
}

impl LogThrottle {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: Instant::now() - interval,
        }
    }

    #[inline]
    pub fn allow(&mut self) -> bool {
        if self.last.elapsed() >= self.interval {
            self.last = Instant::now();
            true
        } else {
            false
        }
    }

    #[inline]
    pub fn reset(&mut self) {
        self.last = Instant::now();
    }

    #[inline]
    pub fn set_interval(&mut self, interval: Duration) {
        self.interval = interval;
    }
}

pub fn cmd_summary(cmd: &GuiCommand) -> String {
    match cmd {
        GuiCommand::Position(_) => "Position(<redacted>)".to_string(),
        GuiCommand::Go(_) => "Go(...)".to_string(),
        GuiCommand::SetOption(name, _v) => format!("SetOption({})", name),
        GuiCommand::Usi => "Usi".to_string(),
        GuiCommand::IsReady => "IsReady".to_string(),
        GuiCommand::UsiNewGame => "UsiNewGame".to_string(),
        GuiCommand::Quit => "Quit".to_string(),
        other => format!("{other:?}"), // それ以外はDebugでOK
    }
}
