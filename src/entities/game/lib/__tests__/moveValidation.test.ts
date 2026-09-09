import { describe, expect, test } from "vitest";
import { Color, Shogi } from "shogi.js";

import { getAllPossibleMoves, hasLegalMove } from "../moveValidation";

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

/** 頭金。後手玉5一の逃げ道を先手金5二が全て塞ぎ、その金を先手歩5三が支えている */
const CHECKMATE = "4k4/4G4/4P4/9/9/9/9/9/4K4 w - 1";

/**
 * 後手番で合法手が無く、王手もかかっていない局面。
 *
 * 後手玉9一の行き先（9二・8一・8二）を先手銀8三と先手金7二が塞ぎ、
 * どちらも9一には利いていない。
 */
const STALEMATE = "k8/2G6/1S7/9/9/9/9/9/4K4 w - 1";

/**
 * 5二への歩打ちが打ち歩詰めになる局面（先手番、持ち駒は歩1枚）。
 *
 * 打った歩は先手金5三が支え、後手玉5一の残りの逃げ道は
 * 金5三（4二・6二）と先手香4九・6九（4一・6一）が塞いでいる。
 */
const UCHIFUDUME = "4k4/9/4G4/9/9/9/9/9/3L1L2K b P 1";

function positionOf(sfen: string): Shogi {
  const shogi = new Shogi();
  shogi.initializeFromSFENString(sfen);
  return shogi;
}

describe("getAllPossibleMoves", () => {
  test("平手初期局面の合法手は30手", () => {
    expect(getAllPossibleMoves(positionOf(HIRATE), Color.Black)).toHaveLength(30);
  });

  test("打ち歩詰めになる歩打ちは含まない", () => {
    const moves = getAllPossibleMoves(positionOf(UCHIFUDUME), Color.Black);

    // 歩を打てる場所自体は他にある。「歩打ちが1つも無い」で通ってしまわないようにする
    expect(moves.some((move) => !move.from && move.kind === "FU")).toBe(true);
    expect(
      moves.some((move) => !move.from && move.kind === "FU" && move.to.x === 5 && move.to.y === 2),
    ).toBe(false);
  });
});

describe("hasLegalMove", () => {
  test.each([
    ["平手初期局面", HIRATE, Color.Black, true],
    ["詰み", CHECKMATE, Color.White, false],
    ["手詰まり", STALEMATE, Color.White, false],
  ])("%s", (_name, sfen, color, expected) => {
    expect(hasLegalMove(positionOf(sfen), color)).toBe(expected);
  });

  test.each([
    ["平手初期局面", HIRATE, Color.Black],
    ["詰み", CHECKMATE, Color.White],
    ["手詰まり", STALEMATE, Color.White],
    ["打ち歩詰めのある局面", UCHIFUDUME, Color.Black],
  ])("%s で getAllPossibleMoves と答えが一致する", (_name, sfen, color) => {
    expect(hasLegalMove(positionOf(sfen), color)).toBe(
      getAllPossibleMoves(positionOf(sfen), color).length > 0,
    );
  });
});
