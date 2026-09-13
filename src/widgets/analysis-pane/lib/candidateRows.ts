import type { AnalysisCandidate, Evaluation } from "@/entities/engine";
import { MULTIPV_MAX } from "@/entities/engine-presets/model/multiPv";

/**
 * 画面に出す候補手の上限。**`MULTIPV_MAX` から導く。**
 *
 * 独立に決めると、プリセットが `MultiPV` を増やせる数と画面が出せる数がずれ、
 * **増やしたぶんが黙って捨てられる。**
 */
export const MAX_VISIBLE_CANDIDATES = MULTIPV_MAX;

/** 画面に出す候補手1件。**評価値は先手視点に揃えてある。** */
export type CandidateRow = {
  /** エンジンが付けた順位。1 が最善 */
  rank: number;
  /** 読み筋。**先手視点に揃えてある**（`convertCandidateToSenteView`） */
  moves: readonly ConvertedMoveLike[];
  /** 先手視点の評価値 */
  evaluation: Evaluation | null;
  /** 最善手か（`rank` の最小値を持つ行） */
  isBest: boolean;
};

/** 読み筋の1手。`shared/lib/shogi/moveText` の `ConvertedMove` と同じ形 */
type ConvertedMoveLike = { move: string; isBlack: boolean };

/**
 * 候補手を画面の行に組む。
 *
 * `raw` は**手番視点のまま**の候補（順位をここから取る）、`senteMoves` と
 * `senteEvaluations` は先手視点に揃えたあとのもの。**添字は `raw` と揃っていること。**
 */
export function buildCandidateRows(
  raw: readonly AnalysisCandidate[],
  senteMoves: readonly (readonly ConvertedMoveLike[])[],
  senteEvaluations: readonly (Evaluation | null)[],
): CandidateRow[] {
  if (raw.length === 0) return [];

  const bestRank = Math.min(...raw.map((c) => c.rank));

  return raw.slice(0, MAX_VISIBLE_CANDIDATES).map((candidate, at) => ({
    rank: candidate.rank,
    moves: senteMoves[at] ?? [],
    evaluation: senteEvaluations[at] ?? null,
    isBest: candidate.rank === bestRank,
  }));
}
