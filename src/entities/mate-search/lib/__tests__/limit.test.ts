import { expect, test } from "vitest";
import { MATE_SEARCH_LIMITS, resolveMateSearchLimit } from "../limit";

test("上限は4つで、既定は30秒。知らない綴りも30秒", () => {
  expect(MATE_SEARCH_LIMITS.map((l) => [l.label, l.ms])).toEqual([
    ["10秒", 10_000],
    ["30秒", 30_000],
    ["60秒", 60_000],
    ["無制限", null],
  ]);
  expect(resolveMateSearchLimit("infinite").ms).toBeNull();
  expect(resolveMateSearchLimit("60").ms).toBe(60_000);
  expect(resolveMateSearchLimit(null).ms).toBe(30_000);
  expect(resolveMateSearchLimit("future").ms).toBe(30_000);
});
