import { describe, expect, test } from "vitest";
import { buildTesuuPointer } from "@/entities/kifu/model/branch";
import { normalizeForkPointers, type ForkPointer } from "@/entities/kifu/model/cursor";
import { buildCursorWithForkSelection, resolveForkSelection } from "../cursorSelection";

/**
 * 「計画した変化」を持つカーソル。`KifuStreamList` の `plannedCursor` と同じ組み方で、
 * `state.branchPlan` をそのまま `forkPointers` に載せる（`te > tesuu` を落とさない）。
 */
const planned = (tesuu: number, forkPointers: ForkPointer[]) => ({
  tesuu,
  forkPointers,
  tesuuPointer: buildTesuuPointer(tesuu, forkPointers),
});

/**
 * 「辿った変化」だけを持つカーソル。`cursorFromSource` と同じく `te <= tesuu` に正規化する。
 * これを比較先に使うと #225 になる。
 */
const traced = (tesuu: number, forkPointers: ForkPointer[]) => {
  const fps = normalizeForkPointers(forkPointers, tesuu);
  return { tesuu, forkPointers: fps, tesuuPointer: buildTesuuPointer(tesuu, fps) };
};

describe("resolveForkSelection", () => {
  describe("カーソルより先の te（計画にだけ選択がある）", () => {
    // 10手目で変化1を選んでから5手目へ戻った状態。行のチェックは変化1のままだが、
    // 「辿った変化」は te <= 5 しか持たないので 10手目については空。
    const plan = [{ te: 10, forkIndex: 0 }];

    test("「本譜」を押したら本譜の指定になる", () => {
      const r = resolveForkSelection(planned(5, plan), 10, null);

      // goto に落ちると、計画を積んだままの goToIndex(10) で変化が確定する（#225）。
      expect(r.kind).toBe("apply");
      if (r.kind !== "apply") return;
      expect(r.cursor.tesuu).toBe(10);
      expect(r.cursor.forkPointers.some((p) => p.te === 10)).toBe(false);
    });

    test("選択済みの変化をもう一度押したら移動だけ", () => {
      expect(resolveForkSelection(planned(5, plan), 10, 0)).toEqual({ kind: "goto", te: 10 });
    });

    test("別の変化を押したらその変化の指定になる", () => {
      const r = resolveForkSelection(planned(5, plan), 10, 1);

      expect(r.kind).toBe("apply");
      if (r.kind !== "apply") return;
      expect(r.cursor.forkPointers).toContainEqual({ te: 10, forkIndex: 1 });
    });

    test("「辿った変化」を比較先にすると本譜と変化が入れ替わる", () => {
      // 比較先を取り違えたときに何が起きるかを固定しておく。上の3件が
      // 「たまたま通っている」のではないことは、この対比で確かめられる。
      const wrong = traced(5, plan);

      expect(wrong.forkPointers).toEqual([]);
      expect(resolveForkSelection(wrong, 10, null)).toEqual({ kind: "goto", te: 10 });
    });
  });

  describe("カーソル以下の te（両方が同じ内容を持つ）", () => {
    const plan = [{ te: 2, forkIndex: 0 }];

    test("選択済みの変化をもう一度押したら移動だけ", () => {
      expect(resolveForkSelection(planned(5, plan), 2, 0)).toEqual({ kind: "goto", te: 2 });
      expect(resolveForkSelection(traced(5, plan), 2, 0)).toEqual({ kind: "goto", te: 2 });
    });

    test("「本譜」を押したら本譜の指定になる", () => {
      for (const base of [planned(5, plan), traced(5, plan)]) {
        const r = resolveForkSelection(base, 2, null);
        expect(r.kind).toBe("apply");
        if (r.kind !== "apply") continue;
        expect(r.cursor).toEqual(buildCursorWithForkSelection(base, 2, null));
      }
    });
  });

  test("計画がまったく無ければ「本譜」は移動だけ", () => {
    expect(resolveForkSelection(planned(0, []), 3, null)).toEqual({ kind: "goto", te: 3 });
  });
});
