//! `info` 行を候補手の一覧（`AnalysisResult`）へ集約する。
//!
//! 検討（`analyzer`）と対局（`game::search`）が同じ関数を呼ぶ。集約の仕方を2つ持たないためにここへ置く。

use usi::{InfoParams, ScoreKind};

use crate::engine::types::{AnalysisCandidate, AnalysisResult, Evaluation, EvaluationKind};

/// `info` 行を解析結果へ集約する。
///
/// 解析と対局で同じ形の読み筋を出す。**2箇所で別々に組み立てない。**
/// 片方だけ直すと、同じエンジンの同じ出力が画面の場所によって違って見える。
///
/// `multipv` の無い行は rank 1 に入る。集約した後、`candidates` を rank の昇順に並べる。
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

/// `rank` の読み筋が最後に受けた深さを返す。その読み筋が無いか、深さを受けていなければ `None`
pub fn depth_of_rank(result: &AnalysisResult, rank: u32) -> Option<u32> {
    result
        .candidates
        .iter()
        .find(|c| c.rank == rank)
        .and_then(|c| c.depth)
}

/// `multipv` の番号を返す。無ければ 1
fn extract_rank(info_params: &[InfoParams]) -> u32 {
    for info in info_params {
        if let InfoParams::MultiPv(r) = info {
            return *r as u32;
        }
    }
    1
}

/// `rank` の読み筋を返す。無ければ空の読み筋を末尾に足して返す
fn get_or_create_candidate(result: &mut AnalysisResult, rank: u32) -> &mut AnalysisCandidate {
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

/// `score` の値と種類を評価値にする。上界・下界のフラグは捨てる
fn map_score_to_evaluation(value: i32, kind: &ScoreKind) -> Evaluation {
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
            // `usi` 0.6.2 は `mate +` を 1、`mate -` を -1 で渡す。0 は来ないが、来たら `+` に倒す
            let plus = value >= 0;
            Evaluation {
                value: if plus { 1 } else { -1 },
                kind: EvaluationKind::MateUnknown(plus),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(line: &str) -> Vec<InfoParams> {
        match usi::EngineCommand::parse(line).expect("解ける") {
            usi::EngineCommand::Info(params) => params,
            other => panic!("info ではない: {other:?}"),
        }
    }

    /// `info` 行を MultiPV の番号ごとに集約し、番号の昇順に並べる。
    /// `multipv` の無い行は1本目に入り、行に無い欄は前の値を残す
    #[test]
    fn info_lines_fold_into_candidates_by_rank() {
        let mut result = AnalysisResult::default();
        apply_info_params(
            &info("info multipv 2 depth 12 nodes 3456 time 1500 score mate -3 pv 2g2f 8c8d"),
            &mut result,
        );
        apply_info_params(
            &info("info depth 10 nodes 1234 time 980 score cp 85 pv 7g7f 3c3d 2g2f"),
            &mut result,
        );
        apply_info_params(&info("info depth 11"), &mut result);

        let ranks: Vec<u32> = result.candidates.iter().map(|c| c.rank).collect();
        assert_eq!(ranks, [1, 2]);

        let first = &result.candidates[0];
        assert_eq!(first.depth, Some(11));
        assert_eq!(first.nodes, Some(1234));
        assert_eq!(first.time_ms, Some(980));
        assert_eq!(first.pv_line, ["7g7f", "3c3d", "2g2f"]);
        assert_eq!(first.first_move.as_deref(), Some("7g7f"));
        assert!(matches!(
            first.evaluation,
            Some(Evaluation {
                value: 85,
                kind: EvaluationKind::Centipawn
            })
        ));

        let second = &result.candidates[1];
        assert_eq!(second.depth, Some(12));
        assert!(matches!(
            second.evaluation,
            Some(Evaluation {
                value: -3,
                kind: EvaluationKind::MateInMoves(-3)
            })
        ));

        assert_eq!(depth_of_rank(&result, 1), Some(11));
        assert_eq!(depth_of_rank(&result, 2), Some(12));
        assert_eq!(depth_of_rank(&result, 3), None);
    }

    /// 手数の分からない詰みは符号だけを持つ
    #[test]
    fn a_mate_without_a_distance_keeps_only_its_sign() {
        let mut result = AnalysisResult::default();
        apply_info_params(&info("info score mate - pv 8h2b+"), &mut result);
        assert!(matches!(
            result.candidates[0].evaluation,
            Some(Evaluation {
                value: -1,
                kind: EvaluationKind::MateUnknown(false)
            })
        ));
    }
}
