import { describe, expect, test } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { sanitizeJkf } from "../sanitizeJkf";

/** 指し手の中身は空の変化の判定に関係しないので、区別が付く印だけ持たせる。 */
function move(comment: string, forks?: JKFMove[][]): JKFMove {
  return forks ? { comments: [comment], forks } : { comments: [comment] };
}

/** 再帰の実体は非公開なので、`JKFData` を通して当てる。 */
function movesOf(moves: JKFMove[]): JKFMove[] {
  return sanitizeJkf({ header: {}, moves }).moves;
}

describe("sanitizeJkf", () => {
  test("空の変化は落ちる", () => {
    const [m] = movesOf([move("a", [[]])]);
    expect(m.forks).toBeUndefined();
  });

  test("先頭が null の変化は落ちる", () => {
    const broken = [null as unknown as JKFMove];
    const [m] = movesOf([move("a", [broken])]);
    expect(m.forks).toBeUndefined();
  });

  test("空の変化を挟んでいても、残る変化の相対順序は変わらない", () => {
    // 番号は詰まる（forks[2] だった y が forks[1] になる）。詰まるぶんの影響は
    // sanitizeJkf の doc にある。ここで固定するのは並べ替えないことだけ。
    const [m] = movesOf([move("a", [[move("x")], [], [move("y")]])]);
    expect(m.forks?.map((f) => f[0].comments)).toEqual([["x"], ["y"]]);
  });

  test("変化の中の変化も掃除する", () => {
    const [m] = movesOf([move("a", [[move("x", [[]])]])]);
    expect(m.forks?.[0][0].forks).toBeUndefined();
  });

  test("変化を持たない手は書き換えない", () => {
    const input = move("a");
    expect(movesOf([input])[0]).toBe(input);
  });
  test("元の JKF は書き換えない", () => {
    const jkf: JKFData = { header: {}, moves: [move("a", [[]])] };
    sanitizeJkf(jkf);
    expect(jkf.moves[0].forks).toEqual([[]]);
  });
});
