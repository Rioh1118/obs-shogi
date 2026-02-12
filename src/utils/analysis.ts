import type { AnalysisCandidate } from "@/commands/engine/types";

export function sortByRank(cands: AnalysisCandidate[]): AnalysisCandidate[] {
  return [...cands].sort((a, b) => a.rank - b.rank);
}

export function pickTopCandidate(
  cands: AnalysisCandidate[],
): AnalysisCandidate | null {
  if (cands.length === 0) return null;
  return cands.find((c) => c.rank === 1) ?? cands[0];
}
