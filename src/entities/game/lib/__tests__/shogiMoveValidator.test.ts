import { describe, expect, test } from "vitest";
import { Color, Shogi } from "shogi.js";

import { ShogiMoveValidator } from "../shogiMoveValidator";

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const validator = new ShogiMoveValidator();

function positionOf(sfen: string): Shogi {
  const shogi = new Shogi();
  shogi.initializeFromSFENString(sfen);
  return shogi;
}

describe("isLegalMove の移動", () => {
  test("動ける升へは指せる", () => {
    const move = { from: { x: 7, y: 7 }, to: { x: 7, y: 6 } };
    expect(validator.isLegalMove(positionOf(HIRATE), move)).toBe(true);
  });

  test("動けない升へは指せない", () => {
    const move = { from: { x: 7, y: 7 }, to: { x: 7, y: 5 } };
    expect(validator.isLegalMove(positionOf(HIRATE), move)).toBe(false);
  });

  test("筋を合わせても段が違えば指せない", () => {
    const move = { from: { x: 8, y: 8 }, to: { x: 8, y: 7 } };
    expect(validator.isLegalMove(positionOf(HIRATE), move)).toBe(false);
  });

  test("駒の無い升からは指せない", () => {
    const move = { from: { x: 5, y: 5 }, to: { x: 5, y: 4 } };
    expect(validator.isLegalMove(positionOf(HIRATE), move)).toBe(false);
  });

  test("手番でない側の駒は指せない", () => {
    const move = { from: { x: 3, y: 3 }, to: { x: 3, y: 4 } };
    expect(validator.isLegalMove(positionOf(HIRATE), move)).toBe(false);
  });

  test("盤の外からは投げずに断る", () => {
    const move = { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } };
    expect(validator.isLegalMove(positionOf(HIRATE), move)).toBe(false);
  });
});

describe("isLegalMove の駒打ち", () => {
  const WHITE_HOLDS_SILVER = "7k1/9/9/9/9/9/9/9/1K7 w s 1";

  /** `Color.Black` は `0` なので、色の有無を真偽で見ると先手の駒打ちだけが全て断られる */
  test("先手の駒打ちは指せる", () => {
    const move = { to: { x: 5, y: 5 }, color: Color.Black, kind: "GI" as const };
    expect(validator.isLegalMove(positionOf("7k1/9/9/9/9/9/9/9/1K7 b S 1"), move)).toBe(true);
  });

  test("後手の駒打ちは指せる", () => {
    const move = { to: { x: 5, y: 5 }, color: Color.White, kind: "GI" as const };
    expect(validator.isLegalMove(positionOf(WHITE_HOLDS_SILVER), move)).toBe(true);
  });

  test("色の無い駒打ちは断る", () => {
    const move = { to: { x: 5, y: 5 }, kind: "GI" as const };
    expect(validator.isLegalMove(positionOf(WHITE_HOLDS_SILVER), move)).toBe(false);
  });

  test("駒種の無い駒打ちは断る", () => {
    const move = { to: { x: 5, y: 5 }, color: Color.White };
    expect(validator.isLegalMove(positionOf(WHITE_HOLDS_SILVER), move)).toBe(false);
  });

  test("駒のある升には打てない", () => {
    const move = { to: { x: 2, y: 1 }, color: Color.White, kind: "GI" as const };
    expect(validator.isLegalMove(positionOf(WHITE_HOLDS_SILVER), move)).toBe(false);
  });
});

describe("getLegalMovesFrom", () => {
  test("動かすと王手放置になる手を除く", () => {
    const pinned = "7k1/9/9/9/4r4/9/4S4/4K4/9 b - 1";
    const moves = validator.getLegalMovesFrom(positionOf(pinned), 5, 7);

    expect(moves.map((move) => move.to)).toEqual([{ x: 5, y: 6 }]);
  });

  test("駒の無い升は空を返す", () => {
    expect(validator.getLegalMovesFrom(positionOf(HIRATE), 5, 5)).toEqual([]);
  });
});
