use std::time::{Duration, Instant};
use usi::{GuiCommand, InfoParams, ScoreKind};

use crate::engine::types::{AnalysisCandidate, AnalysisResult, Evaluation, EvaluationKind};

/// `info` 行を解析結果へ畳み込む。
///
/// 解析と対局で同じ形の読み筋を出す。**2箇所で別々に組み立てない。**
/// 片方だけ直すと、同じエンジンの同じ出力が画面の場所によって違って見える。
pub fn apply_info_params(info_params: &[InfoParams], result: &mut AnalysisResult) {
    let rank = extract_rank(info_params);

    for info in info_params {
        match info {
            InfoParams::MultiPv(_) => {}
            InfoParams::Depth(depth, _seldepth) => {
                let c = get_or_create_candidate(result, rank);
                c.depth = Some(*depth as u32);
            }
            InfoParams::Nodes(nodes) => {
                let c = get_or_create_candidate(result, rank);
                c.nodes = Some(*nodes as u64);
            }
            InfoParams::Time(time) => {
                let c = get_or_create_candidate(result, rank);
                c.time_ms = Some(time.as_millis() as u64);
            }
            InfoParams::Pv(moves) => {
                let c = get_or_create_candidate(result, rank);
                c.pv_line = moves.clone();
                c.first_move = moves.first().cloned();
            }
            InfoParams::Score(value, kind) => {
                let eval = map_score_to_evaluation(*value, kind);
                let c = get_or_create_candidate(result, rank);
                c.evaluation = Some(eval);
            }
            _ => {}
        }
    }
    result.candidates.sort_by_key(|c| c.rank);
}

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

/// 宛先へ流せなかったことを記録する最短間隔。
///
/// **1つに寄せる。** 解析と対局で別々に持つと、片方を動かしたときに
/// もう片方が古いまま残る。同じ判断（emit の失敗は洪水になるので絞る）なので、
/// 両方が使える段に置く。
pub const EMIT_WARN_INTERVAL: Duration = Duration::from_secs(5);

/// ログファイル1本ぶんの予算。**`KeepOne` なので、一周すると前の記録は消える。**
///
/// **絞りの根拠になっている。** 診断の行をどれだけ出してよいかは全部この値から
/// 逆算していて（`engine::commands::game` の `MAX_TRACKED_GAMES` /
/// `MAX_LINES_PER_INTERVAL`）、外来の文字列を切り詰める上限
/// （`GameId` の `MAX_ID_LEN`、`validate_usi_move`）も同じところから来る。
///
/// **数字を離れた場所へ写さない。** 写すと、ここを動かしたときに
/// 逆算した側がまとめて静かに嘘になる。指すときはこの名前で指すこと。
pub const LOG_FILE_BUDGET: u128 = 200_000;

#[derive(Debug, Clone)]
pub struct LogThrottle {
    interval: Duration,
    last: Instant,
}

impl LogThrottle {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            // `Instant::now() - interval` は起動直後に panic する
            // （`Instant` は単調時計で、ブートより前へは遡れない）。
            // 遡れなかったときは初回の `allow` が `false` になるだけ
            last: Instant::now()
                .checked_sub(interval)
                .unwrap_or_else(Instant::now),
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

    /// 枠が空いているか（次の `allow` が必ず通るか）。
    ///
    /// **空いた枠は何も覚えていない。** 捨てても失われる情報が無いので、
    /// 上限のある写像から落とす判断に使える。
    #[inline]
    pub fn is_open(&self) -> bool {
        self.last.elapsed() >= self.interval
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
