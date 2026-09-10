import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";
import { emptyHand, stateFromPreset } from "@/entities/position/lib/positionDraft";
import type { JKFState } from "@/entities/kifu/model/jkf";
import { squareMark, standMark } from "../boardMarks";
import type { Held } from "@/features/position-editor/model/usePositionDraft";

const sq = (x: number, y: number) => ({ x, y });

function emptyState(): JKFState {
  return {
    color: Color.Black,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({}))),
    hands: [emptyHand(), emptyHand()],
  };
}

const HELD_SQUARE: Held = { from: "square", sq: sq(7, 7) };
const HELD_HAND: Held = { from: "hand", kind: "FU", color: Color.Black };

describe("squareMark の blocked", () => {
  const hirate = stateFromPreset("HIRATE");

  test("何も掴んでいなければ、空升が押せない", () => {
    expect(squareMark(hirate, null, null, sq(5, 5)).blocked).toBe(true);
    expect(squareMark(hirate, null, null, sq(7, 7)).blocked).toBe(false);
  });

  test("盤の駒を掴んでいるあいだ、押せない升は1つも無い", () => {
    // 空升へは動き、駒のある升には重なる。掴んだ升自身は「離す」
    for (const [x, y] of [
      [5, 5],
      [7, 7],
      [2, 2],
      [5, 1],
    ]) {
      expect(squareMark(hirate, HELD_SQUARE, null, sq(x!, y!)).blocked).toBe(false);
    }
  });

  test("駒台の駒を掴んでいるあいだ、駒のある升が押せない", () => {
    expect(squareMark(hirate, HELD_HAND, null, sq(7, 7)).blocked).toBe(true);
    expect(squareMark(hirate, HELD_HAND, null, sq(5, 5)).blocked).toBe(false);
  });
});

describe("重ねる予告", () => {
  const hirate = stateFromPreset("HIRATE");

  test("ホバーしていなければ何も出ない", () => {
    const mark = squareMark(hirate, HELD_SQUARE, null, sq(7, 6));
    expect(mark.takes).toBe(false);
    expect(mark.swaps).toBe(false);
  });

  test("空升にホバーしても出ない", () => {
    expect(squareMark(hirate, HELD_SQUARE, sq(5, 5), sq(5, 5)).takes).toBe(false);
  });

  test("駒のある升にホバーすると、その升に「飛ぶ」の印が出る", () => {
    const mark = squareMark(hirate, HELD_SQUARE, sq(2, 2), sq(2, 2));
    expect(mark.takes).toBe(true);
    expect(mark.swaps).toBe(false);
  });

  test("玉にホバーすると、入れ替わる2つの升に印が出る", () => {
    const target = squareMark(hirate, HELD_SQUARE, sq(5, 1), sq(5, 1));
    const source = squareMark(hirate, HELD_SQUARE, sq(5, 1), sq(7, 7));
    expect(target.swaps).toBe(true);
    expect(source.swaps).toBe(true);
    expect(target.takes).toBe(false);
  });

  test("掴んだ升そのものにホバーしても出ない", () => {
    // 同じ升は「離す」であって、重ねるではない
    const mark = squareMark(hirate, HELD_SQUARE, sq(7, 7), sq(7, 7));
    expect(mark.takes).toBe(false);
    expect(mark.swaps).toBe(false);
  });

  test("駒台の駒を掴んでいるときは出ない", () => {
    // 駒のある升へは置けない（沈めてある）ので、重ねる先が無い
    expect(squareMark(hirate, HELD_HAND, sq(2, 2), sq(2, 2)).takes).toBe(false);
  });
});

describe("standMark", () => {
  const hirate = stateFromPreset("HIRATE");

  test("何も掴んでいないとき、空の駒台は沈む", () => {
    expect(standMark(hirate, null, null, Color.Black)).toEqual({
      drop: false,
      nodrop: true,
      dest: false,
    });
  });

  test("駒があれば沈めない。掴む場所として押せる", () => {
    const state = emptyState();
    state.hands[Color.Black].FU = 1;
    expect(standMark(state, null, null, Color.Black).nodrop).toBe(false);
  });

  test("盤の駒を掴んでいると、両方の駒台が置き場として光る", () => {
    expect(standMark(hirate, HELD_SQUARE, null, Color.Black).drop).toBe(true);
    expect(standMark(hirate, HELD_SQUARE, null, Color.White).drop).toBe(true);
  });

  test("玉を掴んでいると、両方の駒台が沈む", () => {
    const heldKing: Held = { from: "square", sq: sq(5, 9) };
    for (const color of [Color.Black, Color.White]) {
      expect(standMark(hirate, heldKing, null, color)).toEqual({
        drop: false,
        nodrop: true,
        dest: false,
      });
    }
  });

  test("駒台の駒を掴んでいると、どちらの駒台も置き場になる", () => {
    // 同じ駒台は「離す」、反対の駒台は「移す」。どちらも何かが起きる
    expect(standMark(hirate, HELD_HAND, null, Color.Black).drop).toBe(true);
    expect(standMark(hirate, HELD_HAND, null, Color.White).drop).toBe(true);
  });

  test("重ねる先にホバーすると、飛んでくる側の駒台だけが名乗る", () => {
    // 行き先は「動かす側」の駒台。取られる駒の持ち主ではない
    expect(standMark(hirate, HELD_SQUARE, sq(2, 2), Color.Black).dest).toBe(true);
    expect(standMark(hirate, HELD_SQUARE, sq(2, 2), Color.White).dest).toBe(false);
  });

  test("玉に重ねる予告では、どちらの駒台も名乗らない", () => {
    // 入れ替わるだけで駒台には入らない
    expect(standMark(hirate, HELD_SQUARE, sq(5, 1), Color.Black).dest).toBe(false);
    expect(standMark(hirate, HELD_SQUARE, sq(5, 1), Color.White).dest).toBe(false);
  });
});
