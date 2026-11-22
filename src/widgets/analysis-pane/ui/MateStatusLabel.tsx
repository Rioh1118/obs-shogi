import { useEffect, useState } from "react";
import type { MateSearchState } from "@/entities/mate-search";
import { formatElapsed } from "@/widgets/analysis-pane/lib/elapsed";

const WORD = {
  starting: "詰み探索の起動中…",
  searching: "詰み探索中",
  finished: "詰み探索完了",
} as const;

/** 探索の起点からの経過秒。起点は provider が持つので、タブを移って戻っても 0 に戻らない */
function useElapsedSeconds(state: MateSearchState): number | null {
  const startedAt = state.phase === "searching" ? state.startedAt : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt !== null) return Math.max(0, Math.floor((now - startedAt) / 1000));
  if (state.phase === "finished" && state.elapsedMs !== null) {
    return Math.floor(state.elapsedMs / 1000);
  }
  return null;
}

/** 詰み探索が表を持つ間の、操作列の左。検討の状態の語は出さない */
export function MateStatusLabel({ state }: { state: MateSearchState }) {
  const elapsed = useElapsedSeconds(state);
  if (state.phase === "closed" || state.phase === "preparing") return null;

  const mark = state.phase === "searching" ? "analyzing" : "idle";
  return (
    <div className="analysis-controls__status">
      <span className={`analysis-controls__dot analysis-controls__dot--${mark}`}></span>
      <span className="analysis-controls__status-text">{WORD[state.phase]}</span>
      {elapsed !== null && (
        <span className="analysis-controls__timer">{formatElapsed(elapsed)}</span>
      )}
    </div>
  );
}
