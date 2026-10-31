import { describe, expect, it } from "vitest";

import { engineStatusOf } from "../engineStatus";

const analysis = (isAnalyzing: boolean, finished = false, analyzedSfen: string | null = "P1") => ({
  isAnalyzing,
  starting: false,
  finished,
  analyzedSfen,
});

/** `docs/state-transitions/engine-standardization.md` の V の判定 */
const base = { notReadyReason: null, failureKind: null };

describe("操作列が言う語", () => {
  it("検討の意思が無ければ待機中", () => {
    expect(
      engineStatusOf({ ...base, phase: "ready", analysis: analysis(false), currentSfen: "P1" }),
    ).toBe("standing-by");
  });

  it("検討の意思があれば検討中", () => {
    expect(
      engineStatusOf({ ...base, phase: "ready", analysis: analysis(true), currentSfen: "P1" }),
    ).toBe("analyzing");
  });

  it("読み終えた局面のままなら検討完了", () => {
    expect(
      engineStatusOf({
        ...base,
        phase: "ready",
        analysis: analysis(true, true),
        currentSfen: "P1",
      }),
    ).toBe("finished");
  });

  it("局面を動かしたら、次の探索が始まる前でも検討完了と言わない", () => {
    expect(
      engineStatusOf({
        ...base,
        phase: "ready",
        analysis: analysis(true, true),
        currentSfen: "P2",
      }),
    ).toBe("analyzing");
  });

  it("応答なしの間は、検討の意思があっても検討中と言わない", () => {
    for (const a of [analysis(true), analysis(true, true), analysis(false)]) {
      expect(
        engineStatusOf({ ...base, phase: "unresponsive", analysis: a, currentSfen: "P1" }),
      ).toBe("unresponsive");
    }
  });

  it("エンジンが終了したら、検討の意思があっても検討中と言わない", () => {
    for (const a of [analysis(true), analysis(true, true), analysis(false)]) {
      expect(engineStatusOf({ ...base, phase: "exited", analysis: a, currentSfen: "P1" })).toBe(
        "exited",
      );
    }
  });

  it("起動を待っている間は、検討の意思があっても起動中", () => {
    for (const phase of ["idle", "initializing", "ready"] as const) {
      expect(
        engineStatusOf({
          ...base,
          phase,
          notReadyReason: "starting",
          analysis: analysis(true),
          currentSfen: "P1",
        }),
      ).toBe("starting");
    }
  });

  it("起動に失敗したら、検討の意思があっても検討中と言わない", () => {
    expect(
      engineStatusOf({
        phase: "error",
        notReadyReason: "failed",
        failureKind: "spawnFailed",
        analysis: analysis(true),
        currentSfen: "P1",
      }),
    ).toBe("failed");
  });

  it("中止した回は起動失敗と言わない", () => {
    expect(
      engineStatusOf({
        phase: "error",
        notReadyReason: "failed",
        failureKind: "cancelled",
        analysis: analysis(false),
        currentSfen: "P1",
      }),
    ).toBe("cancelled");
  });

  it("選択が外れたら、前の失敗が畳まれる前でもエンジンなし", () => {
    for (const phase of ["idle", "error"] as const) {
      expect(
        engineStatusOf({
          phase,
          notReadyReason: "no-engine",
          failureKind: phase === "error" ? "spawnFailed" : null,
          analysis: analysis(false),
          currentSfen: "P1",
        }),
      ).toBe("no-engine");
    }
  });

  it("選んだプリセットが未設定なら起動失敗", () => {
    expect(
      engineStatusOf({
        phase: "idle",
        notReadyReason: "failed",
        failureKind: null,
        analysis: analysis(false),
        currentSfen: "P1",
      }),
    ).toBe("failed");
  });

  it("▶ を押した時点で検討中", () => {
    const pressed = { ...analysis(false), starting: true };
    expect(engineStatusOf({ ...base, phase: "ready", analysis: pressed, currentSfen: "P1" })).toBe(
      "analyzing",
    );
  });
});
