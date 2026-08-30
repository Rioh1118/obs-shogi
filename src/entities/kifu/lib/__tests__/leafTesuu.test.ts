import { describe, expect, test } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import {
  ROOT_CURSOR,
  asBranchPlan,
  plannedCursorFrom,
  type ForkPointer,
} from "@/entities/kifu/model/cursor";
import { computeLeafTesuu } from "../leafTesuu";

const mv = (tag: string, forks?: JKFMove[][]): JKFMove =>
  forks ? { comments: [tag], forks } : { comments: [tag] };

/** 開始局面から計画だけを載せたカーソル。実物と同じく `plannedCursorFrom` を通す */
const planFrom = (branchPlan: ForkPointer[]) =>
  plannedCursorFrom(ROOT_CURSOR, asBranchPlan(branchPlan));

/**
 * 本譜3手。te=2 に**1手だけ**の変化がぶら下がる。
 *
 * 変化の長さを本譜と変えてあるのは、「計画どおり降りた葉」（2）と
 * 「計画を捨てて線を進んだ葉」（3）を別の値で区別するため。同じ長さにすると、
 * 計画を丸ごと無視する実装でも全部通ってしまう。
 */
function kifu(): JKFData {
  return {
    header: {},
    moves: [mv("root"), mv("t1"), mv("t2", [[mv("f2")]]), mv("t3")],
  };
}

describe("computeLeafTesuu", () => {
  test("計画が無ければ本譜の末尾", () => {
    expect(computeLeafTesuu(kifu(), null)).toBe(3);
  });

  test("計画どおり変化へ降りた先の末尾", () => {
    const cursor = planFrom([{ te: 2, forkIndex: 0 }]);
    expect(computeLeafTesuu(kifu(), cursor)).toBe(2);
  });

  test("線の末尾より先に計画が残っていても throw しない", () => {
    // 別の分岐で選んだ計画は mergeBranchPlan が te > tesuu のぶんを残すので、
    // いまの線に存在しない te を指すことがある。手が無いのに forkAndForward を
    // 呼ぶと「N手目に有効な棋譜がありません」を投げ、手数表示が実際より小さく出る。
    // 本譜は te=3 で終わる。計画が te=4 を指していると forkAndForward が呼ばれる。
    const cursor = planFrom([{ te: 4, forkIndex: 0 }]);
    expect(() => computeLeafTesuu(kifu(), cursor)).not.toThrow();
    expect(computeLeafTesuu(kifu(), cursor)).toBe(3);
  });

  test("計画が指す変化が実在しなければ捨てて線を進む", () => {
    // 範囲外・負・非整数のいずれでも同じ。forkAndForward は範囲外なら false を返すが、
    // 負や非整数は forks[-1] を掴んで JKFPlayer の内部で TypeError になる。
    for (const forkIndex of [5, -1, 0.5, NaN]) {
      const cursor = planFrom([{ te: 2, forkIndex }]);
      expect(computeLeafTesuu(kifu(), cursor)).toBe(3);
    }
  });

  test("上限ちょうどの手数は通り、超えると throw する", () => {
    // `while (limit-- > 0)` だと 9999 手で「葉に着いてから」落ちていた。
    // 名前が示す上限と実効値を合わせる。
    const line = (n: number): JKFData => ({
      header: {},
      moves: Array.from({ length: n + 1 }, (_, i) => mv(String(i))),
    });
    expect(computeLeafTesuu(line(10000), null)).toBe(10000);
    expect(() => computeLeafTesuu(line(10001), null)).toThrow(/overflows/);
  });
});
