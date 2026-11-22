import { useMemo } from "react";
import { useAnalysis, type EngineStatus } from "@/entities/analysis";
import type { AnalysisCandidate } from "@/entities/engine";
import { useEnginePresets } from "@/entities/engine-presets";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";
import { useMateSearch, type MateSearchState } from "@/entities/mate-search";
import { useEngineStatus } from "./useEngineStatus";
import { visibleCandidatesOf } from "./visibleCandidates";

const NO_CANDIDATES: readonly AnalysisCandidate[] = [];

/** 詰み探索が表を持つ間の候補手。生の結果だけを出し、検討のキャッシュには入れない */
function mateCandidatesOf(state: MateSearchState): readonly AnalysisCandidate[] {
  return "candidates" in state ? state.candidates : NO_CANDIDATES;
}

type VisibleCandidates = {
  candidates: readonly AnalysisCandidate[];
  status: EngineStatus;
  /** いまの棋譜。キャッシュの範囲 */
  fileKey: string | null;
  /** いまの局面のキャッシュの鍵。組めないときは `null` */
  cacheKey: string | null;
};

/**
 * いま出す候補手。表と読みの量が同じものを見るために、ここで1つに組む。
 *
 * **キャッシュの持ち主は `entities/analysis`。** ここは鍵を組んで読むだけで、書くのは `AnalysisPane`。
 *
 * 停止中に出すのはキャッシュ。**キャッシュを書くのはコミット後の effect なので、読むこのレンダは
 * 書かれる前のキャッシュを見る。** キャッシュの先は ref で、書いても再レンダは起きないので、
 * ある鍵に初めてキャッシュしたときはその鍵が空のまま描かれ、次に deps が動くまで直らない。→ #569
 */
export function useVisibleCandidates(): VisibleCandidates {
  const { state, candidateCache } = useAnalysis();
  const { state: gameState, view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const { selectedNode } = useFileTree();
  const { state: presetsState } = useEnginePresets();
  const status = useEngineStatus(currentSfen);
  const mate = useMateSearch();

  const engineKey = presetsState.selectedPresetId ?? "no-engine";
  const fileKey = selectedNode?.id ?? null;
  const tesuuPointer = gameState.cursor?.tesuuPointer ?? null;
  const cacheKey = fileKey && tesuuPointer ? `${engineKey}${fileKey}:${tesuuPointer}` : null;

  const candidates = useMemo(
    () =>
      mate.ownsTable
        ? mateCandidatesOf(mate.state)
        : visibleCandidatesOf({
            status,
            analysis: state,
            currentSfen,
            lookupCached: () => candidateCache.lookup(cacheKey),
          }),
    [candidateCache, status, state, currentSfen, cacheKey, mate.ownsTable, mate.state],
  );

  return { candidates, status, fileKey, cacheKey };
}
