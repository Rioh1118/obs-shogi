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

    const convertedPVs =
      latestResult?.principal_variations?.map((pv) =>
        convertSfenSequence(pv.moves),
      ) || [];

    return {
      bestMoveSequence: convertedPVs[0] || [],
      candidateSequences: convertedPVs.slice(1),
      evaluation: latestResult?.evaluation?.value || null,
      searchStats: latestResult?.search_stats,
      candidateEvaluations:
        latestResult?.principal_variations
          ?.slice(1)
          .map((pv) => pv.evaluation?.value) || [],
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
