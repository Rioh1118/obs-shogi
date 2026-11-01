import { describe, expect, test } from "vitest";
import { notReadyReasonOf } from "../notReadyReason";

const CHOSEN = { chosen: true, presetIncomplete: false, failureKind: null };

describe("notReadyReasonOf", () => {
  test("選んでいなければ、段や失敗によらず no-engine", () => {
    expect(
      notReadyReasonOf({
        chosen: false,
        presetIncomplete: false,
        phase: "error",
        failureKind: "cancelled",
      }),
    ).toBe("no-engine");
  });

  test("プリセットが未完成なら failed", () => {
    expect(
      notReadyReasonOf({
        chosen: false,
        presetIncomplete: true,
        phase: "idle",
        failureKind: null,
      }),
    ).toBe("failed");
  });

  test.each(["idle", "initializing", "ready"] as const)("選んでいて %s なら starting", (phase) => {
    expect(notReadyReasonOf({ ...CHOSEN, phase })).toBe("starting");
  });

  test.each(["error", "exited", "unresponsive"] as const)("選んでいて %s なら failed", (phase) => {
    expect(notReadyReasonOf({ ...CHOSEN, phase })).toBe("failed");
  });

  test("利用者が中止した失敗だけ cancelled", () => {
    expect(notReadyReasonOf({ ...CHOSEN, phase: "error", failureKind: "cancelled" })).toBe(
      "cancelled",
    );
    expect(notReadyReasonOf({ ...CHOSEN, phase: "error", failureKind: "timedOut" })).toBe("failed");
  });

  test("段が error でなければ、残った失敗の種類を見ない", () => {
    expect(notReadyReasonOf({ ...CHOSEN, phase: "exited", failureKind: "cancelled" })).toBe(
      "failed",
    );
  });
});
