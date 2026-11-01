import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";

import type { JKFData } from "@/entities/kifu/model/jkf";
import { asBranchPlan, ROOT_CURSOR, type KifuCursor } from "@/entities/kifu/model/cursor";
import { buildCursorView } from "../cursorView";

const NO_PLAN = asBranchPlan([]);

const TWO_MOVES: JKFData = {
  header: {},
  moves: [
    { comments: ["開始"] },
    { move: { from: { x: 7, y: 7 }, to: { x: 7, y: 6 }, piece: "FU", color: Color.Black } },
    {
      comments: ["2手目"],
      move: { from: { x: 3, y: 3 }, to: { x: 3, y: 4 }, piece: "FU", color: Color.White },
    },
  ],
};

/** 開始局面の盤に、`shogi.js` が SFEN に綴れない駒種の後手の駒がある棋譜 */
const UNSPELLABLE_PIECE = {
  header: {},
  initial: {
    preset: "OTHER",
    data: {
      color: Color.Black,
      board: Array.from({ length: 9 }, (_, x) =>
        Array.from({ length: 9 }, (_, y) => {
          if (x === 4 && y === 8) return { color: Color.Black, kind: "OU" };
          if (x === 4 && y === 0) return { color: Color.White, kind: "XX" };
          return {};
        }),
      ),
      hands: [{}, {}],
    },
  },
  moves: [{ comments: ["開始"] }],
} as unknown as JKFData;

const EMPTY = {
  player: null,
  lastMove: null,
  currentMove: undefined,
  currentComments: [],
  currentTurn: Color.Black,
  totalMoves: 0,
  currentSfen: null,
};

describe("buildCursorView", () => {
  test("棋譜が無ければ空の表示を返す", () => {
    expect(buildCursorView(null, null, NO_PLAN)).toEqual(EMPTY);
  });

  test("再生できない手を含む棋譜は空の表示を返す", () => {
    const unplayable: JKFData = {
      header: {},
      moves: [
        {},
        { move: { from: { x: 5, y: 5 }, to: { x: 5, y: 4 }, piece: "FU", color: Color.Black } },
      ],
    };
    const cursor = { tesuu: 1, forkPointers: [], tesuuPointer: "1,[]" } as unknown as KifuCursor;

    expect(buildCursorView(unplayable, cursor, NO_PLAN)).toEqual(EMPTY);
  });

  test("手が無い開始局面は手の情報を空にする", () => {
    const view = buildCursorView(TWO_MOVES, ROOT_CURSOR, NO_PLAN);

    expect(view.currentMove).toBeUndefined();
    expect(view.lastMove).toBeNull();
    expect(view.currentComments).toEqual(["開始"]);
    expect(view.currentTurn).toBe(Color.Black);
    expect(view.totalMoves).toBe(2);
    expect(view.currentSfen?.endsWith(" 1")).toBe(true);
  });

  test("進路の先が再生できないときは、いま辿っている線の手数を返す", () => {
    const brokenAfterCursor: JKFData = {
      header: {},
      moves: [
        {},
        { move: { from: { x: 7, y: 7 }, to: { x: 7, y: 6 }, piece: "FU", color: Color.Black } },
        { move: { from: { x: 5, y: 5 }, to: { x: 5, y: 4 }, piece: "FU", color: Color.White } },
      ],
    };

    const view = buildCursorView(brokenAfterCursor, ROOT_CURSOR, NO_PLAN);

    expect(view.player).not.toBeNull();
    expect(view.totalMoves).toBe(2);
  });

  test("SFEN に綴れない駒があっても盤の表示は残す", () => {
    const view = buildCursorView(UNSPELLABLE_PIECE, ROOT_CURSOR, NO_PLAN);

    expect(view.player).not.toBeNull();
    expect(view.currentSfen).toBeNull();
    expect(view.currentComments).toEqual(["開始"]);
  });
});
