import { describe, expect, it } from "vitest";

import type { PositionHit } from "@/entities/search/api/ids";
import { flattenHits, type HitsCache } from "../hitsCache";

const hit = (fileId: number): PositionHit => ({
  occ: { fileId, gen: 1, nodeId: 1 },
  cursor: { tesuu: 0, forkPointers: [] },
});

describe("flattenHits", () => {
  it("届いた順に平らにする", () => {
    const cache: HitsCache = new Map();

    const hits = flattenHits(cache, 1, [[hit(1), hit(2)], [hit(3)]]);

    expect(hits.map((h) => h.occ.fileId)).toEqual([1, 2, 3]);
  });

  /** 呼び手の `useMemo` が同一性で増えたかを読むので、毎回作ると memo が外れ続ける */
  it("増えていなければ同じ配列を返す", () => {
    const cache: HitsCache = new Map();
    const chunks = [[hit(1)]];

    const first = flattenHits(cache, 1, chunks);

    expect(flattenHits(cache, 1, [...chunks])).toBe(first);
  });

  it("増えたら別の配列を返し、前の配列は変えない", () => {
    const cache: HitsCache = new Map();
    const chunk = [hit(1)];

    const first = flattenHits(cache, 1, [chunk]);
    const second = flattenHits(cache, 1, [chunk, [hit(2)]]);

    expect(second).not.toBe(first);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });

  it("並びが続きでなければ作り直す", () => {
    const cache: HitsCache = new Map();

    flattenHits(cache, 1, [[hit(1)]]);
    const rebuilt = flattenHits(cache, 1, [[hit(2)], [hit(3)]]);

    expect(rebuilt.map((h) => h.occ.fileId)).toEqual([2, 3]);
  });

  it("検索ごとに分けて持つ", () => {
    const cache: HitsCache = new Map();

    flattenHits(cache, 1, [[hit(1)]]);
    const other = flattenHits(cache, 2, [[hit(2)]]);

    expect(other.map((h) => h.occ.fileId)).toEqual([2]);
  });
});
