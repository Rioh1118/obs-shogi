import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { ROOT_CURSOR, plannedCursorOf, type ForkPointer } from "@/entities/kifu/model/cursor";
import { buildStreamRowsFromCursor } from "../buildStreamRows";

/** 本譜3手。te=2 に変化が1本。 */
const KIF = `手合割：平手
   1 ７六歩(77)
   2 ３四歩(33)
   3 ２六歩(27)

変化：2手
   2 ８四歩(83)
`;

const rowsFor = (branchPlan: ForkPointer[]) => {
  const cursor = plannedCursorOf(ROOT_CURSOR, branchPlan);
  return buildStreamRowsFromCursor(new JKFPlayer(parseKifuContentToJKF(KIF, "kif")), cursor);
};

describe("buildStreamRowsFromCursor", () => {
  test("計画が無ければ本譜を並べる", () => {
    expect(rowsFor([]).map((r) => r.te)).toEqual([0, 1, 2, 3]);
  });

  test("計画どおり変化へ降りる", () => {
    // 変化は1手なので、降りると本譜より1行短い。
    expect(rowsFor([{ te: 2, forkIndex: 0 }]).map((r) => r.te)).toEqual([0, 1, 2]);
  });

  test("計画が壊れていてもレンダを落とさない", () => {
    // forkAndForward は forks.length 以上なら false を返すが、負や非整数は
    // forks[-1] を掴んで TypeError になる。ここはレンダ中に呼ばれるので、
    // 落ちると棋譜ペインごと消える。
    for (const forkIndex of [5, -1, 0.5, NaN]) {
      expect(() => rowsFor([{ te: 2, forkIndex }])).not.toThrow();
      expect(rowsFor([{ te: 2, forkIndex }]).map((r) => r.te)).toEqual([0, 1, 2, 3]);
    }
  });
});
