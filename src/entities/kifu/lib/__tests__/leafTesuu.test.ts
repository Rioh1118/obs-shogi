import { describe, expect, test } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import type { KifuCursor, ForkPointer } from "@/entities/kifu/model/cursor";
import { buildTesuuPointer } from "@/entities/kifu/model/branch";
import { computeLeafTesuu } from "../leafTesuu";

const mv = (tag: string, forks?: JKFMove[][]): JKFMove =>
  forks ? { comments: [tag], forks } : { comments: [tag] };

function cursorAt(tesuu: number, forkPointers: ForkPointer[]): KifuCursor {
  return { tesuu, forkPointers, tesuuPointer: buildTesuuPointer(tesuu, forkPointers) };
}

/** 本譜3手。te=2 に2手ぶんの変化がぶら下がる。 */
function kifu(): JKFData {
  return {
    header: {},
    moves: [mv("root"), mv("t1"), mv("t2", [[mv("f2"), mv("f3")]]), mv("t3")],
  };
}

describe("computeLeafTesuu", () => {
  test("計画が無ければ本譜の末尾", () => {
    expect(computeLeafTesuu(kifu(), null)).toBe(3);
  });

  test("計画どおり変化へ降りた先の末尾", () => {
    const cursor = cursorAt(0, [{ te: 2, forkIndex: 0 }]);
    expect(computeLeafTesuu(kifu(), cursor)).toBe(3);
  });

  test("線の末尾より先に計画が残っていても throw しない", () => {
    // 別の分岐で選んだ計画は mergeBranchPlan が te > tesuu のぶんを残すので、
    // いまの線に存在しない te を指すことがある。手が無いのに forkAndForward を
    // 呼ぶと「N手目に有効な棋譜がありません」を投げ、手数表示が実際より小さく出る。
    // 本譜は te=3 で終わる。計画が te=4 を指していると forkAndForward が呼ばれる。
    const cursor = cursorAt(0, [{ te: 4, forkIndex: 0 }]);
    expect(() => computeLeafTesuu(kifu(), cursor)).not.toThrow();
    expect(computeLeafTesuu(kifu(), cursor)).toBe(3);
  });

  test("計画が指す変化が実在しなければ本譜へ落ちる", () => {
    // 範囲外・負・非整数のいずれでも同じ。forkAndForward は範囲外なら false を返すが、
    // 負や非整数は forks[-1] を掴んで JKFPlayer の内部で TypeError になる。
    for (const forkIndex of [5, -1, 0.5, NaN]) {
      const cursor = cursorAt(0, [{ te: 2, forkIndex }]);
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
