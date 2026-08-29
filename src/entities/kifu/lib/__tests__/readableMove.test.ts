import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import type { IJSONKifuFormat } from "json-kifu-format/dist/src/Formats";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { applyMoveWithBranch } from "../applyMoveWithBranch";
import { readableMove } from "../readableMove";

/**
 * 入力の指し手は手書きせず、必ずパーサが組み立てたものを渡す。手をリテラルで書くと
 * `promote: false`（不成）のように、実データにだけ現れる形が抜ける。
 *
 * 逆に期待値の文字列は手で書く。ライブラリから取ると同じ関数を左右に置いた恒真テストになり、
 * 委譲先が変わっても落ちなくなる。
 */
function readableMovesOf(content: string, format: "kif" | "jkf"): string[] {
  const jkf = parseKifuContentToJKF(content, format);
  return jkf.moves.flatMap((mf) => (mf.move ? [readableMove(mf.move)] : []));
}

/** 平手から短い手順では作れない配置（同じ駒3枚・持ち駒あり）を置くための JKF ソース文字列。 */
function jkfContentWithBoard(
  pieces: { x: number; y: number; color: number; kind: string }[],
  hands: [Record<string, number>, Record<string, number>],
  move: object,
): string {
  return JSON.stringify(buildJkf(pieces, hands, [{}, { move }]));
}

function buildJkf(
  pieces: { x: number; y: number; color: number; kind: string }[],
  hands: [Record<string, number>, Record<string, number>],
  moves: object[],
): IJSONKifuFormat {
  const board = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({})));
  for (const p of pieces) {
    board[p.x - 1][p.y - 1] = { color: p.color, kind: p.kind };
  }
  return {
    header: {},
    initial: { preset: "OTHER", data: { color: 0, board, hands } },
    moves,
  } as IJSONKifuFormat;
}

const KINGS = [
  { x: 5, y: 9, color: 0, kind: "OU" },
  { x: 5, y: 1, color: 1, kind: "OU" },
];

const HIRATE = "手合割：平手\n";

describe("readableMove", () => {
  test("手番・移動先・駒種を繋げる", () => {
    const [first, second] = readableMovesOf(`${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n`, "kif");
    expect(first).toBe("☗７六歩");
    expect(second).toBe("☖３四歩");
  });

  test("成は「成」、直前と同じ地点は「同」", () => {
    const moves = readableMovesOf(
      `${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角成(88)\n   4 同　銀(31)\n`,
      "kif",
    );
    expect(moves[2]).toBe("☗２二角成");
    expect(moves[3]).toBe("☖同　銀");
  });

  test("不成が「不成」として残る（成れない手と混ざらない）", () => {
    const moves = readableMovesOf(
      `${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角(88)\n`,
      "kif",
    );
    expect(moves[2]).toBe("☗２二角不成");
  });

  describe("相対表記", () => {
    test("左右のみで決まるなら1文字", () => {
      // 平手の初期配置に金は 6九 と 4九。どちらも 5八 に行ける。
      expect(readableMovesOf(`${HIRATE}   1 ５八金(49)\n`, "kif")[0]).toBe("☗５八金右");
    });

    test("上下も左右も他の駒がいるなら2文字を順に並べる", () => {
      const content = jkfContentWithBoard(
        [
          ...KINGS,
          { x: 6, y: 8, color: 0, kind: "KI" },
          { x: 6, y: 9, color: 0, kind: "KI" },
          { x: 4, y: 9, color: 0, kind: "KI" },
        ],
        [{}, {}],
        { from: { x: 6, y: 9 }, to: { x: 5, y: 8 }, piece: "KI" },
      );
      expect(readableMovesOf(content, "jkf")[0]).toBe("☗５八金左上");
    });
  });

  describe("駒打ち", () => {
    test("盤上の駒も同じ地点に行けるなら「打」で区別する", () => {
      const content = jkfContentWithBoard(
        [...KINGS, { x: 4, y: 4, color: 0, kind: "GI" }],
        [{ GI: 1 }, {}],
        { to: { x: 5, y: 3 }, piece: "GI" },
      );
      expect(readableMovesOf(content, "jkf")[0]).toBe("☗５三銀打");
    });

    test("区別が要らない打には「打」を付けない（棋譜の作法どおり）", () => {
      const moves = readableMovesOf(
        `${HIRATE}   1 ７六歩(77)\n   2 ３四歩(33)\n   3 ２二角(88)\n   4 同　銀(31)\n   5 ４五角打\n`,
        "kif",
      );
      expect(moves[4]).toBe("☗４五角");
    });

    test("盤上で作った新規分岐でも、指し手と打ちが別表記になる (issue #74)", () => {
      // 「打」が出るのは applyMoveWithBranch が棋譜全体を再正規化して relative:"H" を
      // 入れるため。その再正規化を外すと分岐カードに同じ文字列が2枚並ぶ。
      const jkf = new JKFPlayer(
        buildJkf([...KINGS, { x: 4, y: 9, color: 0, kind: "KI" }], [{ KI: 1 }, {}], [{}]),
      );
      jkf.inputMove({ from: { x: 4, y: 9 }, to: { x: 3, y: 9 }, piece: "KI" });
      jkf.goto(0);
      applyMoveWithBranch(jkf, { to: { x: 3, y: 9 }, piece: "KI" });

      const mainLine = jkf.kifu.moves[1];
      expect(readableMove(mainLine.move!)).toBe("☗３九金");
      expect(readableMove(mainLine.forks![0][0].move!)).toBe("☗３九金打");
    });
  });
});
