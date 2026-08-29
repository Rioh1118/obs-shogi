import { describe, expect, test } from "vitest";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { readableMove } from "../readableMove";

/**
 * 期待値は手書きせず、必ずパーサを通した手を渡す。
 * 手書きのリテラルだと `promote: false`（不成）のように
 * 「実際に来るが作者が想定しなかった形」を取りこぼす。
 */
function movesOf(content: string, format: "kif" | "jkf"): string[] {
  const jkf = parseKifuContentToJKF(content, format);
  return jkf.moves.filter((mf) => mf.move).map((mf) => readableMove(mf.move));
}

/** 盤面を直接置きたいケース用。相対表記は駒の配置でしか作れない。 */
function jkfWithBoard(
  pieces: { x: number; y: number; color: number; kind: string }[],
  hands: [Record<string, number>, Record<string, number>],
  move: object,
): string {
  const board = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({})));
  for (const p of pieces) {
    board[p.x - 1][p.y - 1] = { color: p.color, kind: p.kind };
  }
  return JSON.stringify({
    header: {},
    initial: { preset: "OTHER", data: { color: 0, board, hands } },
    moves: [{}, { move }],
  });
}

const KINGS = [
  { x: 5, y: 9, color: 0, kind: "OU" },
  { x: 5, y: 1, color: 1, kind: "OU" },
];

describe("readableMove", () => {
  test("手が無ければ空文字", () => {
    expect(readableMove(undefined)).toBe("");
  });

  test("手番・移動先・駒種を繋げる", () => {
    const [first, second] = movesOf("手合割：平手\n   1 ７六歩(77)\n   2 ３四歩(33)\n", "kif");
    expect(first).toBe("☗７六歩");
    expect(second).toBe("☖３四歩");
  });

  test("成は「成」、直前と同じ地点は「同」", () => {
    const moves = movesOf(
      "手合割：平手\n   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角成(88)\n   4 同　銀(31)\n",
      "kif",
    );
    expect(moves[2]).toBe("☗２二角成");
    expect(moves[3]).toBe("☖同　銀");
  });

  test("不成が「不成」として残る（成れない手と混ざらない）", () => {
    const moves = movesOf(
      "手合割：平手\n   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角(88)\n",
      "kif",
    );
    expect(moves[2]).toBe("☗２二角不成");
  });

  describe("相対表記", () => {
    test("左右のみで決まるなら1文字", () => {
      const content = jkfWithBoard(
        [...KINGS, { x: 6, y: 9, color: 0, kind: "KI" }, { x: 4, y: 9, color: 0, kind: "KI" }],
        [{}, {}],
        { from: { x: 4, y: 9 }, to: { x: 5, y: 8 }, piece: "KI" },
      );
      expect(movesOf(content, "jkf")[0]).toBe("☗５八金右");
    });

    test("上下も左右も他の駒がいるなら2文字を順に並べる", () => {
      const content = jkfWithBoard(
        [
          ...KINGS,
          { x: 6, y: 8, color: 0, kind: "KI" },
          { x: 6, y: 9, color: 0, kind: "KI" },
          { x: 4, y: 9, color: 0, kind: "KI" },
        ],
        [{}, {}],
        { from: { x: 6, y: 9 }, to: { x: 5, y: 8 }, piece: "KI" },
      );
      expect(movesOf(content, "jkf")[0]).toBe("☗５八金左上");
    });
  });

  describe("駒打ち", () => {
    test("盤上の駒も同じ地点に行けるなら「打」で区別する", () => {
      const content = jkfWithBoard([...KINGS, { x: 4, y: 4, color: 0, kind: "GI" }], [{ GI: 1 }, {}], {
        to: { x: 5, y: 3 },
        piece: "GI",
      });
      expect(movesOf(content, "jkf")[0]).toBe("☗５三銀打");
    });

    test("区別が要らない打には「打」を付けない（棋譜の作法どおり）", () => {
      const moves = movesOf(
        "手合割：平手\n   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角(88)\n   4 同　銀(31)\n   5 ４五角打\n",
        "kif",
      );
      expect(moves[4]).toBe("☗４五角");
    });
  });
});
