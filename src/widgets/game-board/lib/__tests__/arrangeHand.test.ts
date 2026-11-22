import { describe, expect, test } from "vitest";
import { Piece } from "shogi.js";

import { arrangeHand } from "../arrangeHand";

/**
 * 駒台の並べ方。どの段に何を何枚置くか。
 *
 * 段の割り振りを誤ると駒台からはみ出すか、1段だけに詰まって隣の段が空く。
 * 枚数を落とすと、持っている駒が画面から消える。
 */

const piecesOf = (...kinds: string[]) => kinds.map((kind) => new Piece(`+${kind}`));
const many = (kind: string, n: number) => Array<string>(n).fill(kind);

/** `KA` や `FU×3` の形に縮めて比べる */
function layoutOf(...kinds: string[]) {
  const { rows, isGrouped } = arrangeHand(piecesOf(...kinds));
  return {
    isGrouped,
    rows: rows.map((row) =>
      row.map(({ kind, count }) => (count === 1 ? `${kind}` : `${kind}×${count}`)),
    ),
  };
}

describe("3枚まで", () => {
  test.each([
    [
      ["FU", "KA", "HI"],
      [["HI", "KA", "FU"], [], [], []],
    ],
    [
      ["FU", "KI"],
      [[], ["KI", "FU"], [], []],
    ],
    [["KE"], [[], [], ["KE"], []]],
    [
      ["FU", "FU"],
      [[], [], [], ["FU", "FU"]],
    ],
  ])("いちばん強い駒の段に置く（%j）", (kinds, rows) => {
    expect(layoutOf(...kinds)).toEqual({ rows, isGrouped: false });
  });
});

describe("4枚から12枚", () => {
  test("強い順に、4段へ均して1枚ずつ置く", () => {
    expect(layoutOf("FU", "KY", "GI", "GI", "KI", "KI", "KA", "HI").rows).toEqual([
      ["HI", "KA"],
      ["KI", "KI"],
      ["GI", "GI"],
      ["KY", "FU"],
    ]);
  });

  test("4枚は2枚ずつ。1枚ずつの段にしない", () => {
    expect(layoutOf(...many("FU", 4)).rows).toEqual([["FU", "FU"], ["FU", "FU"], [], []]);
  });

  test("12枚までは1枚ずつ", () => {
    const { rows, isGrouped } = layoutOf(...many("FU", 12));

    expect(isGrouped).toBe(false);
    expect(rows.map((row) => row.length)).toEqual([3, 3, 3, 3]);
  });
});

describe("13枚から", () => {
  test("種類ごとに1枚と枚数を、1段に2つ置く", () => {
    expect(layoutOf("HI", "KA", "KI", "GI", "KY", "KY", "KE", "KE", ...many("FU", 10))).toEqual({
      isGrouped: true,
      rows: [["HI", "KA"], ["KI", "GI"], ["KY×2", "KE×2"], ["FU×10"]],
    });
  });

  test("13枚で種類ごとに変わる", () => {
    expect(layoutOf(...many("FU", 13))).toEqual({
      isGrouped: true,
      rows: [["FU×13"], [], [], []],
    });
  });
});

test("持ち駒が無ければ、どの段も空", () => {
  expect(layoutOf()).toEqual({ rows: [[], [], [], []], isGrouped: false });
});

test("どの枚数でも、持っている枚数を落とさない", () => {
  for (let n = 1; n <= 18; n += 1) {
    const { rows } = arrangeHand(piecesOf("HI", "KE", ...many("FU", n)));
    const total = rows.flat().reduce((sum, item) => sum + item.count, 0);

    expect(total).toBe(n + 2);
  }
});
