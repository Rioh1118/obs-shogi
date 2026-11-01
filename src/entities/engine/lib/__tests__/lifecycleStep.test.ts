import { describe, expect, test } from "vitest";
import type { EnginePhase, EngineRuntimeConfig } from "@/entities/engine/model/types";
import { lifecycleStepOf } from "../lifecycleStep";

const A: EngineRuntimeConfig = { enginePath: "/a", evalPath: null, book: null, values: {} };
const SAME_AS_A: EngineRuntimeConfig = { ...A };
const B: EngineRuntimeConfig = { ...A, enginePath: "/b" };

const NONE = { activeRuntime: null, lastTriedRuntime: null };

/** `docs/state-transitions/engine.md` の表の、設定に関わる列 */
describe("lifecycleStepOf", () => {
  test("設定が外れたら、未起動でなければ止める", () => {
    const phases: EnginePhase[] = ["initializing", "ready", "error", "exited", "unresponsive"];
    for (const phase of phases) {
      expect(lifecycleStepOf({ ...NONE, desiredRuntime: null, phase })).toBe("shutdown");
    }
    expect(lifecycleStepOf({ ...NONE, desiredRuntime: null, phase: "idle" })).toBe("none");
  });

  test("未起動なら起動する", () => {
    expect(lifecycleStepOf({ ...NONE, desiredRuntime: A, phase: "idle" })).toBe("start");
  });

  /** 同じ設定で起動し直すと、落ち続けるエンジンを起動し続ける */
  test.each(["error", "exited"] as const)("%s は別の設定のときだけ起動する", (phase) => {
    const input = { ...NONE, desiredRuntime: A, phase };

    expect(lifecycleStepOf({ ...input, lastTriedRuntime: SAME_AS_A })).toBe("none");
    expect(lifecycleStepOf({ ...input, lastTriedRuntime: B })).toBe("start");
    expect(lifecycleStepOf(input)).toBe("start");
  });

  test("起動中は別の設定なら待たずに起動し、同じ値の設定では何もしない", () => {
    const input = { ...NONE, desiredRuntime: A, phase: "initializing" as const };

    expect(lifecycleStepOf({ ...input, lastTriedRuntime: SAME_AS_A })).toBe("none");
    expect(lifecycleStepOf({ ...input, lastTriedRuntime: B })).toBe("start");
    expect(lifecycleStepOf(input)).toBe("start");
  });

  test.each(["ready", "unresponsive"] as const)("%s は別の設定なら再起動する", (phase) => {
    const input = { ...NONE, desiredRuntime: A, phase };

    expect(lifecycleStepOf({ ...input, activeRuntime: SAME_AS_A })).toBe("none");
    expect(lifecycleStepOf({ ...input, activeRuntime: B })).toBe("restart");
    expect(lifecycleStepOf(input)).toBe("none");
  });

  test("起動済みかどうかは最後に試みた設定では決めない", () => {
    const step = lifecycleStepOf({
      desiredRuntime: A,
      phase: "ready",
      activeRuntime: SAME_AS_A,
      lastTriedRuntime: B,
    });

    expect(step).toBe("none");
  });
});
