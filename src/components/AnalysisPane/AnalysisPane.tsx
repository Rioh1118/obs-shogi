import { useAnalysis } from "@/contexts/AnalysisContext";
import { convertSfenSequence } from "@/utils/sfenConverter";
import type { ConvertedMove } from "@/utils/sfenConverter";
import { useMemo, useState } from "react";
import AnalysisHeader from "./AnalysisPaneHeader";
import BestMoveSection from "./BestMoveSection";
import CandidatesSection from "./CandidatesSection";
import { useGame } from "@/contexts/GameContext";
import { convertMultiPvToSenteView } from "@/utils/usi";

function AnalysisPane() {
  const { state } = useAnalysis();
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { getCurrentTurn } = useGame();

  const displayData = useMemo(() => {
    const latestResult =
      state.analysisResults[state.analysisResults.length - 1];
    const currentTurn = getCurrentTurn();

    if (!latestResult) {
      return {
        bestMoveSequence: [],
        candidateSequences: [],
        evaluation: null,
        searchStats: null,
        candidateEvaluations: [],
        isMultiPvMode: false,
        candidateCount: 0,
      };
    }

    let bestMoveSequence: ConvertedMove[] = [];
    let candidateSequences: ConvertedMove[][] = [];
    let candidateEvaluations: (number | null)[] = [];
    let evaluation: number | null = null;

    if (
      latestResult.is_multi_pv_enabled &&
      latestResult.multi_pv_candidates.length > 0
    ) {
      // **MultiPV有効時の処理**
      const convertedCandidates = convertMultiPvToSenteView(
        latestResult.multi_pv_candidates,
        currentTurn,
      );
      const topCandidate =
        convertedCandidates.find((c) => c.rank === 1) || convertedCandidates[0];

      // 最善手列を取得（1位候補のPV）
      if (topCandidate && topCandidate.pv_line.length > 0) {
        bestMoveSequence = convertSfenSequence(topCandidate.pv_line);
        evaluation = topCandidate.evaluation || null;
      }

      // 全候補を処理
      candidateSequences = convertedCandidates.map((candidate) =>
        convertSfenSequence(
          candidate.pv_line.length > 0
            ? candidate.pv_line
            : [candidate.first_move],
        ),
      );
      candidateEvaluations = convertedCandidates.map(
        (candidate) => candidate.evaluation || null,
      );

      console.log("🎯 [ANALYSIS_PANE] MultiPV mode:", {
        candidateCount: convertedCandidates.length,
        topMove: topCandidate?.first_move,
        topEvaluation: topCandidate?.evaluation,
        bestMoveCount: bestMoveSequence.length,
      });
    } else {
      // **従来のSingle PV処理**
      bestMoveSequence = latestResult.pv
        ? convertSfenSequence(latestResult.pv)
        : [];
      evaluation = latestResult.evaluation || null;

      // Single PVの場合、最善手のみを候補として表示
      if (latestResult.best_move?.move_str) {
        candidateSequences = [
          convertSfenSequence([latestResult.best_move.move_str]),
        ];
        candidateEvaluations = [
          latestResult.best_move.evaluation || evaluation,
        ];
      }

      console.log("🎯 [ANALYSIS_PANE] Single PV mode:", {
        bestMove: latestResult.best_move?.move_str,
        evaluation: evaluation,
        bestMoveCount: bestMoveSequence.length,
      });
    }

    return {
      bestMoveSequence,
      candidateSequences,
      evaluation,
      searchStats: {
        depth: latestResult.depth,
        nodes: latestResult.nodes,
        time_ms: latestResult.time_ms,
      },
      candidateEvaluations,
      isMultiPvMode: latestResult.is_multi_pv_enabled,
      candidateCount: latestResult.is_multi_pv_enabled
        ? latestResult.multi_pv_candidates.length
        : latestResult.best_move
          ? 1
          : 0,
    };
  }, [state.analysisResults, getCurrentTurn]);

  return (
    <div className="analysis-pane">
      <BestMoveSection
        bestMove={displayData.bestMoveSequence}
        evaluation={displayData.evaluation}
      />
      <CandidatesSection
        candidateSequences={displayData.candidateSequences}
        candidateEvaluations={displayData?.candidateEvaluations.map((el) =>
          el !== undefined ? el : null,
        )}
      />
    </div>
  );
}

export default AnalysisPane;
