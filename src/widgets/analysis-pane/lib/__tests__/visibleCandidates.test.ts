import { describe, expect, it } from "vitest";

import type { EngineStatus } from "@/entities/analysis";
import type { AnalysisCandidate } from "@/entities/engine";
import { candidatesAreStale, visibleCandidatesOf } from "../visibleCandidates";

const live: AnalysisCandidate[] = [{ rank: 1, pv_line: ["7g7f"] }];
const cached: AnalysisCandidate[] = [{ rank: 1, pv_line: ["2g2f"] }];

const show = (status: EngineStatus, isAnalyzing: boolean, analyzedSfen: string) =>
  visibleCandidatesOf({
    status,
    analysis: { isAnalyzing, candidates: live, analyzedSfen },
    currentSfen: "P1",
    lookupCached: () => cached,
  });

/** `engine-standardization.md` の「候補手の見え方」の表 */
describe("候補手の見え方", () => {
  it.each(["analyzing", "finished"] as const)("%s は盤と同じ局面の結果だけを出す", (status) => {
    expect(show(status, true, "P1")).toBe(live);
    expect(show(status, true, "P0")).toEqual([]);
  });

  it.each(["starting", "unresponsive", "exited", "failed", "cancelled"] as const)(
    "%s は盤と同じ局面なら結果を残し、違えば控えを出す",
    (status) => {
      expect(show(status, true, "P1")).toBe(live);
      expect(show(status, true, "P0")).toBe(cached);
    },
  );

  it("待機中は控えを出す", () => {
    expect(show("standing-by", false, "P1")).toBe(cached);
  });

  it("エンジンが動いていない間だけ薄く出す", () => {
    const stale: EngineStatus[] = ["starting", "unresponsive", "exited", "failed", "cancelled"];
    const fresh: EngineStatus[] = ["standing-by", "analyzing", "finished"];
    expect(stale.every(candidatesAreStale)).toBe(true);
    expect(fresh.some(candidatesAreStale)).toBe(false);
  });
});
