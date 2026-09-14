/**
 * 毎手の裁定が、棋譜を根から組み直していないか。
 *
 * **数えるのは時間ではなく `append` の回数。** 壁時計だと台の速度に左右されるうえ、
 * 隣の `outcomeCost.test.ts` が持っている「400手を1手ずつ裁定しても合計20秒以内」は
 * 実測で60倍の余裕があり、**組み直しに戻る後退を1つも止められない**
 * （2乗のまま1000手まで伸ばしても緑のままだった）。
 *
 * n 手を1手ずつ裁定すると、根から組み直す形では `append` が n(n+1)/2 回になる。
 * 持ち回る形なら n 回。**その差が1局の値段そのもの**——実測で400手 624ms → 15ms。
 */
import { describe, expect, test, vi } from "vitest";
import { Record as ShogiRecord } from "tsshogi";

import { createOutcomeJudge, judgeGameOutcome } from "../gameOutcome";
import type { GameRules } from "../gameRules";

const NO_LIMIT: GameRules = { jishogiRule: "none", maxMoves: 0 };

/** 玉2枚だけを往復させる。**千日手にも当たる**が、ここが測るのは値段だけ */
const KING_SHUFFLE = "4k4/9/9/9/9/9/9/9/4K4 b - 1";
const CYCLE = ["5i4i", "5a4a", "4i5i", "4a5a"];

const PLIES = 60;

/** `run` の間に棋譜へ手を積んだ回数 */
function appendsDuring(run: () => void): number {
  let appends = 0;
  const original = ShogiRecord.prototype.append;

  const spy = vi.spyOn(ShogiRecord.prototype, "append").mockImplementation(function (
    this: ShogiRecord,
    ...args: Parameters<typeof original>
  ) {
    appends++;
    return original.apply(this, args);
  });

  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return appends;
}

/** 1手ずつ、そのつど現在局面を裁定する */
function judgeEachPly(judge: (usiMoves: string[]) => void): void {
  const usiMoves: string[] = [];
  for (let ply = 0; ply < PLIES; ply++) {
    usiMoves.push(CYCLE[ply % CYCLE.length]);
    judge([...usiMoves]);
  }
}

describe("毎手の裁定の値段", () => {
  test("持ち回る判定器は、進んだぶんしか積まない", () => {
    const judge = createOutcomeJudge();

    const appends = appendsDuring(() => {
      judgeEachPly((usiMoves) => {
        judge.judge({ startSfen: KING_SHUFFLE, usiMoves }, NO_LIMIT);
      });
    });

    // **上限は機械の閾値。** 1手につき1回が理想で、余裕は組み直し1回ぶんだけ置く
    expect(appends).toBeLessThanOrEqual(PLIES * 2);
    // 走査が空振りして0回を「速い」と読まないための下限
    expect(appends).toBeGreaterThanOrEqual(PLIES);
  });

  /**
   * **比較対象。** 上の上限が「速い」を意味することを、遅い側の実測で裏付ける。
   * `judgeGameOutcome` が組み直しをやめたらこの数は合わなくなるので、
   * そのときはこの検査ごと消すこと（比べる相手が無くなるため）。
   */
  test("根から組み直す形は、手数の2乗で積む", () => {
    const appends = appendsDuring(() => {
      judgeEachPly((usiMoves) => {
        judgeGameOutcome({ startSfen: KING_SHUFFLE, usiMoves }, NO_LIMIT);
      });
    });

    expect(appends).toBe((PLIES * (PLIES + 1)) / 2);
  });
});
