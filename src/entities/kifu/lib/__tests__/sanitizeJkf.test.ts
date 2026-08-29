import { describe, expect, test } from "vitest";
import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";
import { sanitizeJkf, sanitizeJkfMoves } from "../sanitizeJkf";

/** 指し手の中身は空の変化の判定に関係しないので、区別が付く印だけ持たせる。 */
function move(comment: string, forks?: JKFMove[][]): JKFMove {
  return forks ? { comments: [comment], forks } : { comments: [comment] };
}

describe("sanitizeJkfMoves", () => {
  test("空の変化は落ちる", () => {
    const [m] = sanitizeJkfMoves([move("a", [[]])]);
    expect(m.forks).toBeUndefined();
  });

  test("先頭が null の変化は落ちる", () => {
    const broken = [null as unknown as JKFMove];
    const [m] = sanitizeJkfMoves([move("a", [broken])]);
    expect(m.forks).toBeUndefined();
  });

  test("空の変化を挟んでいても、残る変化の相対順序は変わらない", () => {
    // 番号は詰まる（forks[2] だった y が forks[1] になる）。詰まること自体は
    // 避けられないので、せめて並べ替えはしない。並べ替えると、保存し直した
    // ファイルの変化の順序が読み込みのたびに変わる。
    const [m] = sanitizeJkfMoves([move("a", [[move("x")], [], [move("y")]])]);
    expect(m.forks?.map((f) => f[0].comments)).toEqual([["x"], ["y"]]);
  });

  test("変化の中の変化も掃除する", () => {
    const [m] = sanitizeJkfMoves([move("a", [[move("x", [[]])]])]);
    expect(m.forks?.[0][0].forks).toBeUndefined();
  });

  test("変化を持たない手は書き換えない", () => {
    const input = move("a");
    expect(sanitizeJkfMoves([input])[0]).toBe(input);
  });
});

describe("sanitizeJkf", () => {
  test("元の JKF は書き換えない", () => {
    const jkf: JKFData = { header: {}, moves: [move("a", [[]])] };
    sanitizeJkf(jkf);
    expect(jkf.moves[0].forks).toEqual([[]]);
  });
});
