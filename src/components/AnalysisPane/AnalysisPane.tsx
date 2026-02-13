import { useAnalysis } from "@/contexts/AnalysisContext";
import { convertSfenSequence } from "@/utils/sfenConverter";
import type { ConvertedMove } from "@/utils/sfenConverter";
import { useEffect, useMemo, useRef } from "react";
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
import { useFileTree } from "@/contexts/FileTreeContext";

type PaneSnapshot = {
  candidates: AnalysisCandidate[];
  savedAt: number;
};

function AnalysisPane() {
  const { state } = useAnalysis();

  const { getCurrentTurn, state: gameState } = useGame();
  const { currentSfen } = usePosition();
  const { selectedNode } = useFileTree();
  // ===== cache key =====
  const fileKey = selectedNode?.id ?? null;
  const posKey = gameState.cursor?.tesuuPointer ?? null;
  const cacheKey = fileKey && posKey ? `${fileKey}:${posKey}` : null;

  // ===== cache storage (UI responsibility) =====
  const cacheRef = useRef<Map<string, PaneSnapshot>>(new Map());
  const lastFileKeyRef = useRef<string | null>(null);

  // ファイルが変わったら全破棄
  useEffect(() => {
    if (fileKey !== lastFileKeyRef.current) {
      cacheRef.current.clear();
      lastFileKeyRef.current = fileKey;
    }
  }, [fileKey]);

  useEffect(() => {
    if (!cacheKey) return;
    if (!currentSfen) return;
    if (!state.candidates || state.candidates.length === 0) return;
    if (state.currentPosition && state.currentPosition !== currentSfen) return;

    cacheRef.current.set(cacheKey, {
      candidates: state.candidates,
      savedAt: Date.now(),
    });
  }, [cacheKey, currentSfen, state.candidates, state.currentPosition]);

  const visibleCandidates: AnalysisCandidate[] = useMemo(() => {
    if (state.isAnalyzing) return state.candidates ?? [];
    if (!cacheKey) return [];
    return cacheRef.current.get(cacheKey)?.candidates ?? [];
  }, [state.isAnalyzing, state.candidates, cacheKey]);

  const displayData = useMemo(() => {
    const currentTurn = getCurrentTurn();
    const senteCandidates: AnalysisCandidate[] = visibleCandidates.map((c) =>
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
  }, [currentSfen, getCurrentTurn, visibleCandidates]);

  return (
    <section className="analysis-pane">
      <div className="analysis-pane__surface">
        <AnalysisPaneHeader />
        <main className="analysis-pane__body">
          <BestMoveSection
            bestMove={displayData.bestMoveSequence}
            evaluation={displayData.evaluation}
          />
          <CandidatesSection
            candidateSequences={displayData.candidateSequences}
            candidateEvaluations={displayData?.candidateEvaluations}
          />
        </main>
        <footer className="analysis-pane__footer">
          <StatsSection searchStats={displayData.searchStats} />
        </footer>
      </div>
    </section>
  );
}

export default AnalysisPane;
