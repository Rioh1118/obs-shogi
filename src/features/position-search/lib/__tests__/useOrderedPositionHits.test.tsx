// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import type { PositionHit } from "@/entities/search";
import { useOrderedPositionHits } from "../useOrderedPositionHits";

/**
 * 並べ替えが**新しく届いたぶんだけ**を見ること。
 *
 * 一覧はチャンクが届くたびに伸びるので、毎回全件を走らせると `resolveAbsPath` の
 * 呼び出しが二乗で伸びる（実測で n=100,000 のとき合計 2,357ms。
 * `.claude/reviews/2026-09-07-447-position-search-perf-r1.md` M-4）。呼び出し回数は
 * 画面のどこにも出ないので、**数える以外に見る方法が無い**。
 */

const CURRENT = "/root/open.kif";

function hitAt(fileId: number): PositionHit {
  return { occ: { fileId, gen: 1, nodeId: fileId }, cursor: { tesuu: 1, forkPointers: [] } };
}

/** 偶数の fileId をいま開いている棋譜のヒットにする */
const resolve = vi.fn((hit: PositionHit) =>
  hit.occ.fileId % 2 === 0 ? CURRENT : `/root/${hit.occ.fileId}.kif`,
);

/** 末尾に n 件足した新しい配列。`getHitsByRequestId` が返す形（写し・追記のみ） */
function grow(hits: PositionHit[], n: number): PositionHit[] {
  return [...hits, ...Array.from({ length: n }, (_, i) => hitAt(hits.length + i))];
}

// 式のまま書かない。`mockClear()` はモック自身を返すので、vitest がそれを
// 後片付けの関数と見なして引数無しで呼ぶ
beforeEach(() => {
  resolve.mockClear();
});

describe("useOrderedPositionHits", () => {
  test("開いている棋譜のヒットを先頭へ寄せ、元の相対順序を保つ", () => {
    const hits = [hitAt(0), hitAt(1), hitAt(2), hitAt(3), hitAt(4)];
    const { result } = renderHook(() => useOrderedPositionHits(hits, resolve, CURRENT));

    expect(result.current.map((h) => h.occ.fileId)).toEqual([0, 2, 4, 1, 3]);
  });

  test("開いている棋譜が無ければ、届いた順のまま返す", () => {
    const hits = [hitAt(0), hitAt(1)];
    const { result } = renderHook(() => useOrderedPositionHits(hits, resolve, null));

    expect(result.current).toBe(hits);
    expect(resolve).not.toHaveBeenCalled();
  });

  /**
   * 10 回に分けて 2 件ずつ届いたとき、全件を走らせていれば 2+4+…+20 = 110 回。
   * 増分なら 20 回
   */
  test("届くたびに全件を振り分け直さない", () => {
    let hits: PositionHit[] = [];
    const { result, rerender } = renderHook(() => useOrderedPositionHits(hits, resolve, CURRENT));

    for (let i = 0; i < 10; i++) {
      hits = grow(hits, 2);
      rerender();
    }

    expect(result.current).toHaveLength(20);
    expect(resolve.mock.calls.length).toBeLessThanOrEqual(20);
  });

  test("増えていないのに描き直されただけなら、1件も振り分けない", () => {
    const hits = [hitAt(0), hitAt(1)];
    const { result, rerender } = renderHook(() => useOrderedPositionHits(hits, resolve, CURRENT));
    const first = result.current;
    resolve.mockClear();

    rerender();

    expect(resolve).not.toHaveBeenCalled();
    expect(result.current).toBe(first);
  });

  /** 増分にした結果、伸びたことが呼び手へ伝わらなくなってはいけない */
  test("増えたら別の配列になる", () => {
    let hits = [hitAt(0), hitAt(1)];
    const { result, rerender } = renderHook(() => useOrderedPositionHits(hits, resolve, CURRENT));
    const first = result.current;

    hits = grow(hits, 2);
    rerender();

    expect(result.current).not.toBe(first);
    expect(result.current).toHaveLength(4);
  });

  /** 別の棋譜を開いたら寄せ先が変わる。前の振り分けを引き継いではいけない */
  test("開いている棋譜が変わったら振り分け直す", () => {
    const hits = [hitAt(0), hitAt(1), hitAt(2)];
    let currentAbs = CURRENT;
    const { result, rerender } = renderHook(() =>
      useOrderedPositionHits(hits, resolve, currentAbs),
    );
    expect(result.current.map((h) => h.occ.fileId)).toEqual([0, 2, 1]);

    currentAbs = "/root/1.kif";
    rerender();

    expect(result.current.map((h) => h.occ.fileId)).toEqual([1, 0, 2]);
  });

  /** 検索し直すと、同じ長さでも中身は別のヒット。前の振り分けに足してはいけない */
  test("別の検索の結果に入れ替わったら振り分け直す", () => {
    let hits = [hitAt(0), hitAt(1), hitAt(2)];
    const { result, rerender } = renderHook(() => useOrderedPositionHits(hits, resolve, CURRENT));
    expect(result.current).toHaveLength(3);

    // 同じ fileId でも実体は別。前の結果とは繋がっていない
    hits = [hitAt(0), hitAt(1), hitAt(2), hitAt(3)];
    rerender();

    expect(result.current.map((h) => h.occ.fileId)).toEqual([0, 2, 1, 3]);
    // 前の結果の実体が混ざっていないこと
    expect(result.current.every((h) => hits.includes(h))).toBe(true);
  });
});
