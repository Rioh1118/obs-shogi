import { useAnalysis } from "@/contexts/AnalysisContext";
import { convertSfenSequence } from "@/utils/sfenConverter";
import type { ConvertedMove } from "@/utils/sfenConverter";
import { useMemo } from "react";
import BestMoveSection from "./BestMoveSection";
import CandidatesSection from "./CandidatesSection";
import { useGame } from "@/contexts/GameContext";
import { convertMultiPvToSenteView } from "@/utils/usi";
import AnalysisPaneHeader from "./AnalysisPaneHeader";
import "./AnalysisPane.scss";
import { usePosition } from "@/contexts/PositionContext";
import StatsSection from "./StatsSection";

function AnalysisPane() {
  const { state } = useAnalysis();

  const { getCurrentTurn } = useGame();
  const { currentSfen } = usePosition();

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
        bestMoveSequence = convertSfenSequence(
          currentSfen,
          topCandidate.pv_line,
        );
        evaluation = topCandidate.evaluation || null;
      }

      // 2位以下の候補のみをCandidateSectionに渡す
      const otherCandidate = convertedCandidates.filter((c) => c.rank > 1);
      candidateSequences = otherCandidate.map((candidate) =>
        convertSfenSequence(
          currentSfen,
          candidate.pv_line.length > 0
            ? candidate.pv_line
            : [candidate.first_move],
        ),
      );
      candidateEvaluations = otherCandidate.map(
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
        ? convertSfenSequence(currentSfen, latestResult.pv)
        : [];
      evaluation = latestResult.evaluation || null;

      candidateSequences = [];
      candidateEvaluations = [];

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
        ? latestResult.multi_pv_candidates.length - 1
        : 0,
    };
  }, [state.analysisResults, getCurrentTurn, currentSfen]);

  return (
    <div className="analysis-pane">
      <AnalysisPaneHeader />
      <BestMoveSection
        bestMove={displayData.bestMoveSequence}
        evaluation={displayData.evaluation}
      />
      <CandidatesSection
        candidateSequences={displayData.candidateSequences}
        candidateEvaluations={displayData?.candidateEvaluations}
      />
      <StatsSection searchStats={displayData.searchStats} />
    </div>
  );
}

export default AnalysisPane;
