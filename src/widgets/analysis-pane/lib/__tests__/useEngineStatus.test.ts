// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useEngineStatus } from "../useEngineStatus";

/**
 * 操作列と候補手の表が読むエンジンの状態。
 *
 * 起動の失敗の種類を渡し損ねると、利用者が中止した起動が `起動失敗` と出る。
 */

const engine = {
  state: { phase: "error", error: { kind: "cancelled" } as { kind: string } | null },
  notReadyReason: null,
};
const analysis = {
  state: { isAnalyzing: false, starting: false, finished: false, analyzedSfen: null },
};

vi.mock("@/entities/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/engine")>();
  const mocked = {
    ...actual,
    useEngine: (() => engine) as unknown as typeof actual.useEngine,
  };
  return mocked satisfies typeof import("@/entities/engine");
});
vi.mock("@/entities/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/analysis")>();
  const mocked = {
    ...actual,
    useAnalysis: (() => analysis) as unknown as typeof actual.useAnalysis,
  };
  return mocked satisfies typeof import("@/entities/analysis");
});

describe("エンジンの状態", () => {
  test("中止した起動は、起動の失敗と別の状態にする", () => {
    engine.state.error = { kind: "cancelled" };

    expect(renderHook(() => useEngineStatus("P1")).result.current).toBe("cancelled");
  });

  test("他の種類の起動の失敗は、起動の失敗", () => {
    engine.state.error = { kind: "spawnFailed" };

    expect(renderHook(() => useEngineStatus("P1")).result.current).toBe("failed");
  });
});
