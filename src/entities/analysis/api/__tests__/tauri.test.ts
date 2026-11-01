import { describe, expect, test } from "vitest";
import { isAnalysisStartUnreachable } from "../tauri";

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
