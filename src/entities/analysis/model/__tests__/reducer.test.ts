import { describe, expect, it } from "vitest";

import { analysisReducer, initialState } from "../reducer";
import type { AnalysisState } from "../types";

/**
 * 停止が**何を残すか**を固定する。
 *
 * 候補手の控え（`lib/candidateCache.ts`）は「`analyzedSfen` と `candidates` が
 * 同じ解析の組である」ことを前提に、`AnalysisPane` の門で局面を突き合わせてから控える。
 * 停止でどちらか片方だけが落ちると、その組が崩れたまま門を通る回が生まれる。
 *
 * **書き手の場所は `stateFieldWriters` が見るが、残ることは誰も見ていない。**
 */
describe("解析の停止が残すもの", () => {
  const analyzing = (): AnalysisState =>
    analysisReducer(
      analysisReducer(initialState, { type: "start_analysis", payload: { sfen: "SFEN-A" } }),
      { type: "update_result", payload: { candidates: [{ rank: 1, pv_line: [] }] } },
    );

  it("解析した局面と候補手を残す", () => {
    const stopped = analysisReducer(analyzing(), { type: "stop_analysis" });

    expect(stopped.isAnalyzing).toBe(false);
    expect(stopped.analyzedSfen).toBe("SFEN-A");
    expect(stopped.candidates).toHaveLength(1);
  });

  it("結果を捨てる指示では候補手が消え、解析した局面は残る", () => {
    const cleared = analysisReducer(analyzing(), { type: "clear_results" });

    expect(cleared.candidates).toHaveLength(0);
    expect(cleared.analyzedSfen).toBe("SFEN-A");
  });
});
