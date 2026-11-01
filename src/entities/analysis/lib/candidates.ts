import type { AnalysisCandidate } from "@/entities/engine";

/**
 * `rank` の昇順に並べる。結果を受ける `analysisReducer` の中でだけ呼ぶ。
 */
export function sortByRank(cands: AnalysisCandidate[]): AnalysisCandidate[] {
  return [...cands].sort((a, b) => a.rank - b.rank);
}

/**
 * 最善手を1つ取り出す。候補手が空なら `null`。
 *
 * `rank === 1` が無ければ先頭を返す。MultiPV を返さないエンジンや、探索の途中で2位以降だけが
 * 届いたときに `null` を返すと、候補手は出ているのに最善手の欄だけが空く。
 */
export function pickTopCandidate(cands: AnalysisCandidate[]): AnalysisCandidate | null {
  if (cands.length === 0) return null;
  return cands.find((c) => c.rank === 1) ?? cands[0];
}
