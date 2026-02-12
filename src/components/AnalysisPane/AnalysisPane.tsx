import { useAnalysis } from "@/contexts/AnalysisContext";
import { convertSfenSequence } from "@/utils/sfenConverter";
import type { ConvertedMove } from "@/utils/sfenConverter";
import { useMemo } from "react";
import BestMoveSection from "./BestMoveSection";
import CandidatesSection from "./CandidatesSection";
import { useGame } from "@/contexts/GameContext";
import { convertCandidateToSenteView } from "@/utils/usi";
import AnalysisPaneHeader from "./AnalysisPaneHeader";
import "./AnalysisPane.scss";
import { usePosition } from "@/contexts/PositionContext";
import StatsSection from "./StatsSection";
import type { AnalysisCandidate, Evaluation } from "@/commands/engine/types";
import { pickTopCandidate } from "@/utils/analysis";

function AnalysisPane() {
  const { state } = useAnalysis();

  const { getCurrentTurn } = useGame();
  const { currentSfen } = usePosition();

  const displayData = useMemo(() => {
    const currentTurn = getCurrentTurn();
    const senteCandidates: AnalysisCandidate[] = state.candidates.map((c) =>
      convertCandidateToSenteView(c, currentTurn),
    );
    const top = pickTopCandidate(senteCandidates);
    const others = top
      ? senteCandidates.filter((c) => c.rank !== top.rank)
      : senteCandidates;

    const bestMoveSequence: ConvertedMove[] = top?.pv_line?.length
      ? convertSfenSequence(currentSfen, top.pv_line)
      : top?.first_move
        ? convertSfenSequence(currentSfen, [top.first_move])
        : [];

    const candidateSequences: ConvertedMove[][] = others.map((c) =>
      convertSfenSequence(
        currentSfen,
        c.pv_line?.length ? c.pv_line : c.first_move ? [c.first_move] : [],
      ),
    );

    const evaluation: Evaluation | null = top?.evaluation ?? null;

    const candidateEvaluations: (Evaluation | null)[] = others.map(
      (c) => c.evaluation ?? null,
    );

    const searchStats = top
      ? {
          depth: top.depth ?? null,
          nodes: top.nodes ?? null,
          time_ms: top.time_ms ?? null,
        }
      : null;

    return {
      bestMoveSequence,
      candidateSequences,
      evaluation,
      candidateEvaluations,
      searchStats,
      candidateCount: others.length,
    };
  }, [currentSfen, getCurrentTurn, state.candidates]);

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
