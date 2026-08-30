import { describe, expect, test } from "vitest";
import { ROOT_CURSOR, type ForkPointer, type KifuCursor } from "@/entities/kifu/model/cursor";
import {
  mergeBranchPlan,
  plannedForkIndexAt,
  selectAt,
  truncatePlanFrom,
  upsertForkPointer,
} from "../branchPlan";

const fp = (te: number, forkIndex: number): ForkPointer => ({ te, forkIndex });

describe("selectAt", () => {
  test("te の選択を上書きする", () => {
    expect(selectAt([fp(2, 0), fp(4, 1)], 2, 3)).toEqual([fp(2, 3), fp(4, 1)]);
  });

  test("null は te の選択を消す（本譜を選ぶ）", () => {
    expect(selectAt([fp(2, 0), fp(4, 1)], 2, null)).toEqual([fp(4, 1)]);
  });

  // 0 は「変化の0番目」であって本譜ではない。取り違えると別の枝が選ばれる。
  test("forkIndex 0 は消さずに書き込む", () => {
    expect(selectAt([fp(2, 1)], 2, 0)).toEqual([fp(2, 0)]);
  });

  test("無い te に null を渡しても壊れない", () => {
    expect(selectAt([fp(2, 0)], 5, null)).toEqual([fp(2, 0)]);
  });

  test("返りは te 昇順", () => {
    expect(selectAt([fp(5, 0), fp(1, 0)], 3, 1)).toEqual([fp(1, 0), fp(3, 1), fp(5, 0)]);
  });
});

describe("plannedForkIndexAt", () => {
  test("計画があればその forkIndex", () => {
    expect(plannedForkIndexAt([fp(2, 1)], 2)).toBe(1);
  });

  test("forkIndex 0 は null にならない", () => {
    expect(plannedForkIndexAt([fp(2, 0)], 2)).toBe(0);
  });

  test("計画が無ければ null（本譜）", () => {
    expect(plannedForkIndexAt([fp(2, 0)], 3)).toBeNull();
  });
});

describe("truncatePlanFrom", () => {
  test("te 以降を捨てる。te そのものも捨てる", () => {
    expect(truncatePlanFrom([fp(1, 0), fp(3, 0), fp(5, 0)], 3)).toEqual([fp(1, 0)]);
  });
});

describe("upsertForkPointer", () => {
  test("同じ te は上書きし、te 昇順で返す", () => {
    expect(upsertForkPointer([fp(3, 0), fp(1, 0)], 3, 2)).toEqual([fp(1, 0), fp(3, 2)]);
  });
});

describe("mergeBranchPlan", () => {
  const cursorAt = (tesuu: number, forkPointers: ForkPointer[]): KifuCursor => ({
    ...ROOT_CURSOR,
    tesuu,
    forkPointers,
  });

  // 不変条件1: te <= cursor.tesuu の範囲は cursor.forkPointers からしか取らない
  test("カーソル以下の範囲は cursor が勝ち、計画側は無視される", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [fp(2, 9)]);
    expect(merged).toEqual([fp(2, 0)]);
  });

  test("カーソルより先の計画は持ち越す", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [fp(5, 1)]);
    expect(merged).toEqual([fp(2, 0), fp(5, 1)]);
  });

  test("overridePlan もカーソルより先だけ効く", () => {
    const merged = mergeBranchPlan(cursorAt(3, [fp(2, 0)]), [], [fp(1, 9), fp(6, 1)]);
    expect(merged).toEqual([fp(2, 0), fp(6, 1)]);
  });

  test("overridePlan は同じ te で prevPlan に勝つ", () => {
    const merged = mergeBranchPlan(cursorAt(1, []), [fp(4, 0)], [fp(4, 1)]);
    expect(merged).toEqual([fp(4, 1)]);
  });
});
