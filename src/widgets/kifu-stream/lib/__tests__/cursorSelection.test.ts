import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { buildTesuuPointer } from "@/entities/kifu/model/cursor";
import {
  asBranchPlan,
  normalizeForkPointers,
  plannedCursorFrom,
  type ForkPointer,
} from "@/entities/kifu/model/cursor";
import { buildStreamRowsFromCursor } from "../buildStreamRows";
import { resolveForkSelection } from "../cursorSelection";

/** 本譜3手。te=2 に変化が1本。`buildStreamRows.test.ts` と同じ形 */
const KIF = `手合割：平手
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２六歩(27)

変化：2手
   2 ８四歩(83)
`;

const rowsFor = (branchPlan: ForkPointer[]) =>
  buildStreamRowsFromCursor(
    new JKFPlayer(parseKifuContentToJKF(KIF, "kif")),
    plannedCursor(0, branchPlan),
  );

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
  const planned = plannedCursorFrom(cursor, asBranchPlan(branchPlan));
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

  test("行のチェックと食い違う計画は、押せる選択肢のどれとも一致しない", () => {
    // buildStreamRowsFromCursor は forks の範囲外の計画では本譜へ落ち、行のチェックも
    // 本譜に付く。一方この関数は範囲外の値をそのまま読むので、2つは食い違う。
    // 害が出ないのは、その値がメニューの選択肢に無いから（選択肢も同じ forks から作る）。
    //
    // 選択肢は手で書かず、行が持つ forkCount から組む。手で書くと、選択肢の作られ方が
    // ずれて範囲外の値が選択肢の内側に入っても、このテストは緑のまま通る。
    const plan = [{ te: 2, forkIndex: 9 }];
    const row = rowsFor(plan).find((r) => r.te === 2);
    if (!row) throw new Error("te=2 の行が無い");

    // 行は本譜に ✓ を描く（計画とは食い違う）
    expect(row.selectedForkIndex).toBeNull();

    const options = [null, ...Array.from({ length: row.forkCount }, (_, i) => i)];
    for (const forkIndex of options) {
      expect(resolveForkSelection(plannedCursor(0, plan), 2, forkIndex).kind).toBe("applyCursor");
    }
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
      // 壊れた値が残りうるのは te > tesuu の側だけ。te <= tesuu の分は
      // navigate / applyCursor / edit / swap / delete のどの経路も cursorFromPlayer で
      // 引き直すので、player が実際に辿った選択しか入らない。
      //
      // 負・非整数を捨てる検査は advanceWithPlan の1箇所にある。ここはその手前で、
      // 検査を通らずに goto まで届く経路を見ている（buildCursorWithForkSelection は
      // 値を検査しない）。forkIndex が forks の範囲内で負・非整数なら JKFPlayer の
      // 内部で TypeError になり applyCursor の catch が受ける。**範囲外の正の整数なら
      // forkAndForward が false を返し、goto は返り値を見ないので、例外も出ないまま
      // 別の線に着く。**
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
