import { describe, expect, it } from "vitest";

import { engineStatusOf } from "../engineStatus";

const analysis = (isAnalyzing: boolean, finished = false, analyzedSfen: string | null = "P1") => ({
  isAnalyzing,
  finished,
  analyzedSfen,
});

/** `docs/state-transitions/engine-standardization.md` の V の判定 */
describe("操作列が言う語", () => {
  it("検討の意思が無ければ待機中", () => {
    expect(engineStatusOf({ phase: "ready", analysis: analysis(false), currentSfen: "P1" })).toBe(
      "standing-by",
    );
  });

  it("検討の意思があれば検討中", () => {
    expect(engineStatusOf({ phase: "ready", analysis: analysis(true), currentSfen: "P1" })).toBe(
      "analyzing",
    );
  });

  it("読み終えた局面のままなら検討完了", () => {
    expect(
      engineStatusOf({ phase: "ready", analysis: analysis(true, true), currentSfen: "P1" }),
    ).toBe("finished");
  });

  it("局面を動かしたら、次の探索が始まる前でも検討完了と言わない", () => {
    expect(
      engineStatusOf({ phase: "ready", analysis: analysis(true, true), currentSfen: "P2" }),
    ).toBe("analyzing");
  });

  it("エンジンが終了したら、検討の意思があっても検討中と言わない", () => {
    for (const a of [analysis(true), analysis(true, true), analysis(false)]) {
      expect(engineStatusOf({ phase: "exited", analysis: a, currentSfen: "P1" })).toBe("exited");
    }
  });
});
