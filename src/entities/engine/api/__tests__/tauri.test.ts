import { beforeEach, describe, expect, test, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock(
  "@tauri-apps/api/core",
  async (actual) =>
    ({
      ...(await actual<typeof import("@tauri-apps/api/core")>()),
      invoke,
    }) satisfies typeof import("@tauri-apps/api/core"),
);

const { setPositionFromSfen, isAnalysisStartUnreachable } = await import("../tauri");

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("setPositionFromSfen", () => {
  test("SFEN を手を加えずに Rust の position へ渡す", async () => {
    const sfen = "sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

    await setPositionFromSfen(sfen);

    expect(invoke).toHaveBeenCalledExactlyOnceWith("set_position", { position: sfen });
  });
});

describe("isAnalysisStartUnreachable", () => {
  test("エンジンへ書けなかった断りだけを真にする", () => {
    expect(isAnalysisStartUnreachable({ unreachable: true })).toBe(true);
    expect(isAnalysisStartUnreachable({ unreachable: false })).toBe(false);
    expect(isAnalysisStartUnreachable({ unreachable: "true" })).toBe(false);
    expect(isAnalysisStartUnreachable({})).toBe(false);
  });

  test("オブジェクトでない値は投げずに偽にする", () => {
    expect(isAnalysisStartUnreachable(null)).toBe(false);
    expect(isAnalysisStartUnreachable(undefined)).toBe(false);
    expect(isAnalysisStartUnreachable("unreachable")).toBe(false);
  });
});
