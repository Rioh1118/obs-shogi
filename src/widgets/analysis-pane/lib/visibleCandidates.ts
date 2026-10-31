import type { AnalysisState, EngineStatus } from "@/entities/analysis";
import type { AnalysisCandidate } from "@/entities/engine";

type Inputs = {
  status: EngineStatus;
  analysis: Pick<AnalysisState, "isAnalyzing" | "candidates" | "analyzedSfen">;
  currentSfen: string | null;
  /** いまの局面の控えを引く。**読まない枝では呼ばない** */
  lookupCached: () => readonly AnalysisCandidate[];
};

/**
 * 表に出す候補手。**見るのは2つ、局面が盤と同じか、エンジンがいま動いているか**
 * （`docs/spec/features/engine-standardization.md` の「候補手の見え方」）。
 *
 * **読んでいる間は生の結果だけを出す。** 局面を切り替えている間は、新しい候補手が届くまで
 * 空にする（控えを出すと、読み始めた結果と入れ替わって飛ぶ）。
 */
export function visibleCandidatesOf({
  status,
  analysis,
  currentSfen,
  lookupCached,
}: Inputs): readonly AnalysisCandidate[] {
  const samePosition = analysis.analyzedSfen === currentSfen;
  if (status === "analyzing" || status === "finished") {
    return samePosition ? analysis.candidates : [];
  }
  return analysis.isAnalyzing && samePosition ? analysis.candidates : lookupCached();
}

/** エンジンが動いていない間の候補手は、止まる前の結果なので薄く出す */
export function candidatesAreStale(status: EngineStatus): boolean {
  return status !== "standing-by" && status !== "analyzing" && status !== "finished";
}
