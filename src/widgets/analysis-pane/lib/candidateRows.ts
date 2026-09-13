import type { AnalysisCandidate, Evaluation } from "@/entities/engine";
import { MULTIPV_MAX } from "@/features/settings/lib/presetDialog";

/**
 * 画面に出す候補手の上限。**`MULTIPV_MAX` から導く。**
 *
 * 独立に決めると、プリセットが `MultiPV` を増やせる数と画面が出せる数がずれ、
 * **増やしたぶんが黙って捨てられる。**
 */
export const MAX_VISIBLE_CANDIDATES = MULTIPV_MAX;

/** 画面に出す候補手1件。**評価値は先手視点、Δ は手番視点。** */
export type CandidateRow = {
  /** エンジンが付けた順位。1 が最善 */
  rank: number;
  /** 読み筋。**先手視点に揃えてある**（`convertCandidateToSenteView`） */
  moves: readonly ConvertedMoveLike[];
  /** 先手視点の評価値 */
  evaluation: Evaluation | null;
  /**
   * 最善手との差（センチポーン）。**手番から見るので常に 0 以下。**
   *
   * どちらかが詰み（`Centipawn` でない）なら `null`。詰みと点数の差は
   * 引き算に意味が無い。
   */
  delta: number | null;
  /** 最善手か（`rank` の最小値を持つ行） */
  isBest: boolean;
};

/** 読み筋の1手。`sfenConverter` の `ConvertedMove` と同じ形 */
type ConvertedMoveLike = { move: string; isBlack: boolean };

/** `Centipawn` のときだけ点数を返す。詰みは `null` */
function centipawn(evaluation: Evaluation | null | undefined): number | null {
  if (!evaluation) return null;
  return evaluation.kind === "Centipawn" ? evaluation.value : null;
}

/**
 * 候補手を画面の行に組む。
 *
 * `raw` は**手番視点のまま**の候補（Δ をここから取る）、`senteMoves` と
 * `senteEvaluations` は先手視点に揃えたあとのもの。**添字は `raw` と揃っていること。**
 *
 * Δ を手番視点で取るのは、先手視点に揃えたあとだと後手番で符号が反転して
 * 「最善手がいちばん小さい Δ」になるため。
 */
export function buildCandidateRows(
  raw: readonly AnalysisCandidate[],
  senteMoves: readonly (readonly ConvertedMoveLike[])[],
  senteEvaluations: readonly (Evaluation | null)[],
): CandidateRow[] {
  if (raw.length === 0) return [];

  const bestRank = Math.min(...raw.map((c) => c.rank));
  const best = raw.find((c) => c.rank === bestRank);
  const bestScore = centipawn(best?.evaluation);

  return raw.slice(0, MAX_VISIBLE_CANDIDATES).map((candidate, at) => {
    const score = centipawn(candidate.evaluation);

    return {
      rank: candidate.rank,
      moves: senteMoves[at] ?? [],
      evaluation: senteEvaluations[at] ?? null,
      delta: score !== null && bestScore !== null ? score - bestScore : null,
      isBest: candidate.rank === bestRank,
    };
  });
}

/** Δ の表示。`0` は `±0`、届かないものは `—` */
export function formatDelta(delta: number | null): string {
  if (delta === null) return "—";
  if (delta === 0) return "±0";
  return `${delta}`;
}
