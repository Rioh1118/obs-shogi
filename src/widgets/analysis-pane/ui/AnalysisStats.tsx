import { useMemo } from "react";
import { pickTopCandidate } from "@/entities/analysis";
import { useVisibleCandidates } from "@/widgets/analysis-pane/lib/useVisibleCandidates";
import StatsSection from "./StatsSection";

/** 検討ビューの読みの量。表に出している候補手の、最善手の数を出す */
function AnalysisStats() {
  const { candidates } = useVisibleCandidates();

  const searchStats = useMemo(() => {
    const top = pickTopCandidate([...candidates]);
    return top
      ? { depth: top.depth ?? null, nodes: top.nodes ?? null, time_ms: top.time_ms ?? null }
      : null;
  }, [candidates]);

  return <StatsSection searchStats={searchStats} />;
}

export default AnalysisStats;
