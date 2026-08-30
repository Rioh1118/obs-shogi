import { describe, expect, test } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { resolveLine } from "../resolveLine";

const mv = (tag: string, forks?: JKFMove[][]): JKFMove =>
  forks ? { comments: [tag], forks } : { comments: [tag] };

/** 本譜3手。te=2 に2手の変化、その変化の te=3 にさらに変化。 */
function kifu(): JKFData {
  return {
    header: {},
    moves: [mv("root"), mv("t1"), mv("t2", [[mv("f2"), mv("f3", [[mv("g3")]])]]), mv("t3")],
  };
}

const moveAt = (uptoTe: number, fps: { te: number; forkIndex: number }[], te: number) => {
  const { line, startTe } = resolveLine(kifu(), fps, uptoTe);
  return line[te - startTe]?.comments;
};

describe("resolveLine", () => {
  test("計画が無ければ本譜のまま", () => {
    const { line, startTe } = resolveLine(kifu(), [], 3);
    expect(startTe).toBe(0);
    expect(line[3]?.comments).toEqual(["t3"]);
  });

  // doc が「用途で1つずれる」と言っている境界。te=2 の分岐を持つカーソルで
  // uptoTe=2 を渡すと、その分岐を降りないので本譜の手が返る。例外は出ないので、
  // 取り違えるとコメントが同じ絶対手数の本譜の手に書かれる。
  test("te の分岐を持つとき、uptoTe=te は降りず、uptoTe=te+1 で降りる", () => {
    const fps = [{ te: 2, forkIndex: 0 }];

    expect(moveAt(2, fps, 2)).toEqual(["t2"]); // 降りていない = 本譜
    expect(moveAt(3, fps, 2)).toEqual(["f2"]); // 降りた = 変化
  });

  test("入れ子の変化でも startTe を持ち直す", () => {
    const fps = [
      { te: 2, forkIndex: 0 },
      { te: 3, forkIndex: 0 },
    ];
    const { line, startTe } = resolveLine(kifu(), fps, 4);

    expect(startTe).toBe(3);
    expect(line[0]?.comments).toEqual(["g3"]);
  });

  test("uptoTe より先の計画は降りない", () => {
    const { startTe } = resolveLine(kifu(), [{ te: 2, forkIndex: 0 }], 2);
    expect(startTe).toBe(0);
  });

  test("実在しない変化を指せば throw する", () => {
    expect(() => resolveLine(kifu(), [{ te: 2, forkIndex: 9 }], 3)).toThrow(/resolveLine failed/);
  });

  test("中身の無い変化も throw する", () => {
    const empty: JKFData = { header: {}, moves: [mv("root"), mv("t1", [[]]), mv("t2")] };
    expect(() => resolveLine(empty, [{ te: 1, forkIndex: 0 }], 2)).toThrow(/resolveLine failed/);
  });
});
