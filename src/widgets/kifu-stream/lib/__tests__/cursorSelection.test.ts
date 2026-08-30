import { describe, expect, test } from "vitest";
import { buildTesuuPointer } from "@/entities/kifu/model/branch";
import {
  normalizeForkPointers,
  plannedCursorFrom,
  type ForkPointer,
} from "@/entities/kifu/model/cursor";
import { resolveForkSelection } from "../cursorSelection";

/**
 * 実物と同じ組み方で `PlannedCursor` を作る。
 *
 * `state.cursor.forkPointers` は `te <= tesuu` に正規化された「辿った変化」、
 * `state.branchPlan` はそれに `te > tesuu` の計画を足したもの。
 * `te <= tesuu` の範囲で両者が一致するのが `game.md` の不変条件1で、
 * `normalizeForkPointers` を通しているのはそれを守るため。
 */
const plannedCursor = (tesuu: number, branchPlan: ForkPointer[]) => {
  const traced = normalizeForkPointers(branchPlan, tesuu);
  const cursor = { tesuu, forkPointers: traced, tesuuPointer: buildTesuuPointer(tesuu, traced) };
  const planned = plannedCursorFrom(cursor, branchPlan);
  if (!planned) throw new Error("plannedCursorFrom returned null for a non-null cursor");
  return planned;
};

describe("resolveForkSelection", () => {
  describe("カーソルより先の te（計画にだけ選択がある）", () => {
    // 10手目で変化1を選んでから5手目へ戻った状態。行のチェックは変化1のままだが、
    // 「辿った変化」は te <= 5 しか持たないので 10手目については空。
    const plan = [{ te: 10, forkIndex: 0 }];

    test("「本譜」を押したら本譜のカーソルになる", () => {
      const r = resolveForkSelection(plannedCursor(5, plan), 10, null);

      // goToIndex に落ちると、計画を積んだままの goto で変化が確定してしまう。
      expect(r.kind).toBe("applyCursor");
      if (r.kind !== "applyCursor") return;
      expect(r.cursor.tesuu).toBe(10);
      expect(r.cursor.forkPointers.some((p) => p.te === 10)).toBe(false);
    });

    test("選択済みの変化をもう一度押したら移動だけ", () => {
      expect(resolveForkSelection(plannedCursor(5, plan), 10, 0)).toEqual({
        kind: "goToIndex",
        te: 10,
      });
    });

    test("別の変化を押したらその変化のカーソルになる", () => {
      const r = resolveForkSelection(plannedCursor(5, plan), 10, 1);

      expect(r.kind).toBe("applyCursor");
      if (r.kind !== "applyCursor") return;
      expect(r.cursor.forkPointers).toContainEqual({ te: 10, forkIndex: 1 });
    });

    test("計画を落とした値を比較先にすると「本譜」だけが変化へ落ちる", () => {
      // 「辿った変化」だけを載せた値。型では渡せないので、同じ内容を計画として組んで再現する。
      // 壊れるのは「本譜」の一方向だけで、変化を押す側は不一致のまま正しく動く。
      const dropped = plannedCursor(5, normalizeForkPointers(plan, 5));

      expect(dropped.forkPointers).toEqual([]);
      expect(resolveForkSelection(dropped, 10, null)).toEqual({ kind: "goToIndex", te: 10 });
      expect(resolveForkSelection(dropped, 10, 0).kind).toBe("applyCursor");
    });
  });

  describe("カーソル以下の te（辿った変化と計画が一致する範囲）", () => {
    const plan = [{ te: 2, forkIndex: 0 }];

    test("選択済みの変化をもう一度押したら移動だけ", () => {
      expect(resolveForkSelection(plannedCursor(5, plan), 2, 0)).toEqual({
        kind: "goToIndex",
        te: 2,
      });
    });

    test("「本譜」を押したら te の選択が落ちる", () => {
      const r = resolveForkSelection(plannedCursor(5, plan), 2, null);

      expect(r.kind).toBe("applyCursor");
      if (r.kind !== "applyCursor") return;
      expect(r.cursor.tesuu).toBe(2);
      expect(r.cursor.forkPointers.some((p) => p.te === 2)).toBe(false);
    });
  });

  test("計画がまったく無ければ「本譜」は移動だけ", () => {
    expect(resolveForkSelection(plannedCursor(0, []), 3, null)).toEqual({
      kind: "goToIndex",
      te: 3,
    });
  });

  describe("戻り値のどこを落とし、どこを持ち越すか", () => {
    test("押した te より先の計画は戻り値から落ちる", () => {
      const r = resolveForkSelection(
        plannedCursor(5, [
          { te: 10, forkIndex: 0 },
          { te: 15, forkIndex: 2 },
        ]),
        10,
        null,
      );

      // 落ちるのはこの戻り値の中だけ。state.branchPlan に残っている te=15 は
      // applyCursor の mergeBranchPlan が復活させる（docs/state-transitions/game.md の不変条件3）。
      expect(r.kind).toBe("applyCursor");
      if (r.kind !== "applyCursor") return;
      expect(r.cursor.forkPointers.some((p) => p.te === 15)).toBe(false);
    });

    test("押した te より手前の壊れた計画は持ち越す", () => {
      // 壊れた値が残りうるのは te > tesuu の側だけ。te <= tesuu は cursorFromPlayer 由来で、
      // 壊れていれば cursorView の buildPlayer が先に落ちて棋譜ペインが出ない。
      //
      // 負・非整数を捨てる検査は computeLeafTesuu と buildStreamRowsFromCursor にある。
      // ここで3箇所目を書くと寄せ先が増えるだけなので書かない。この値は goto まで届き、
      // その te に forks があれば JKFPlayer の内部で TypeError になって applyCursor の
      // catch が受ける。**forks が無ければ forkAndForward が false を返し、goto は
      // 返り値を見ないので、例外も出ないまま別の線に着く。** → #213
      for (const forkIndex of [7, -1, 0.5, NaN]) {
        const plan = [
          { te: 3, forkIndex },
          { te: 10, forkIndex: 0 },
        ];
        const r = resolveForkSelection(plannedCursor(2, plan), 10, null);

        expect(r.kind).toBe("applyCursor");
        if (r.kind !== "applyCursor") continue;
        expect(r.cursor.forkPointers).toContainEqual({ te: 3, forkIndex });
      }
    });
  });
});
