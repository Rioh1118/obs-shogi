import { useAnalysis } from "@/contexts/AnalysisContext";
import { convertSfenSequence } from "@/utils/sfenConverter";
import type { ConvertedMove } from "@/utils/sfenConverter";
import { useMemo, useState } from "react";
import AnalysisHeader from "./AnalysisPaneHeader";
import BestMoveSection from "./BestMoveSection";
import CandidatesSection from "./CandidatesSection";

function AnalysisPane() {
  const { state } = useAnalysis();
  const [showDetailedStats, setShowDetailedStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const displayData = useMemo(() => {
    const latestResult =
      state.analysisResults[state.analysisResults.length - 1];

    if (!latestResult) {
      return {
        bestMoveSequence: [],
        candidateSequences: [],
        evaluation: null,
        searchStats: null,
        candidateEvaluations: [],
      };
    }

    const bestMoveSequence = latestResult.pv
      ? convertSfenSequence(latestResult.pv)
      : [];

    const candidateSequences =
      latestResult.candidate_moves?.map((candidate) =>
        convertSfenSequence([candidate.move_str]),
      ) || [];

    const candidateEvaluations =
      latestResult.candidate_moves?.map((candidate) => candidate.evaluation) ||
      [];

    console.log("🎯 [ANALYSIS_PANE] Processed data:", {
      bestMoveCount: bestMoveSequence.length,
      candidateCount: candidateSequences.length,
      evaluation: latestResult.evaluation,
      depth: latestResult.depth,
    });

    return {
      bestMoveSequence,
      candidateSequences,
      evaluation: latestResult.evaluation || null,
      searchStats: {
        depth: latestResult.depth,
        nodes: latestResult.nodes,
        time_ms: latestResult.time_ms,
      },
      candidateEvaluations,
    };
  }, [state.analysisResults]);

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
