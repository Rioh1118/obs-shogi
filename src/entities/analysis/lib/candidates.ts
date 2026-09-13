import type { AnalysisCandidate } from "@/entities/engine";

/**
 * `rank` の昇順に並べる。**通すのは `reducer` の `update_result` だけ**で、
 * ここが唯一の並べ替え地点（だから barrel には出さない）。
 */
export function sortByRank(cands: AnalysisCandidate[]): AnalysisCandidate[] {
  return [...cands].sort((a, b) => a.rank - b.rank);
}

/**
 * 最善手を1つ取り出す。
 *
 * **`rank === 1` が無ければ先頭に落とす。** MultiPV を返さないエンジンや、
 * 探索の途中で 2位以降だけが届いた回に `null` を返すと、**候補手は出ているのに
 * 最善手の欄だけが空く**。並びは `sortByRank` が保証している。
 */
export function pickTopCandidate(cands: AnalysisCandidate[]): AnalysisCandidate | null {
  if (cands.length === 0) return null;
  return cands.find((c) => c.rank === 1) ?? cands[0];
}
