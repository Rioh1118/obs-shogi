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

describe("getLegalMovesFrom", () => {
  test("動ける升だけを返す", () => {
    const moves = validator.getLegalMovesFrom(positionOf(HIRATE), 7, 7);

    expect(moves.map((move) => move.to)).toEqual([{ x: 7, y: 6 }]);
  });

  test("味方に囲まれた駒は空を返す", () => {
    expect(validator.getLegalMovesFrom(positionOf(HIRATE), 8, 8)).toEqual([]);
  });

  test("手番でない側の駒は空を返す", () => {
    expect(validator.getLegalMovesFrom(positionOf(HIRATE), 3, 3)).toEqual([]);
  });

  test("動かすと王手放置になる手を除く", () => {
    const pinned = "7k1/9/9/9/4r4/9/4S4/4K4/9 b - 1";
    const moves = validator.getLegalMovesFrom(positionOf(pinned), 5, 7);

    expect(moves.map((move) => move.to)).toEqual([{ x: 5, y: 6 }]);
  });

  test("駒の無い升は空を返す", () => {
    expect(validator.getLegalMovesFrom(positionOf(HIRATE), 5, 5)).toEqual([]);
  });
});

describe("getLegalDropsByKind", () => {
  const WHITE_HOLDS_SILVER = "7k1/9/9/9/9/9/9/9/1K7 w s 1";

  /** `Color.Black` は `0` なので、色の有無を真偽で見ると先手の駒打ちだけが全て断られる */
  test("先手の持ち駒を打てる", () => {
    const drops = validator.getLegalDropsByKind(
      positionOf("7k1/9/9/9/9/9/9/9/1K7 b S 1"),
      Color.Black,
      "GI",
    );

    expect(drops.map((move) => move.to)).toContainEqual({ x: 5, y: 5 });
  });

  test("後手の持ち駒を打てる", () => {
    const drops = validator.getLegalDropsByKind(positionOf(WHITE_HOLDS_SILVER), Color.White, "GI");

    expect(drops.map((move) => move.to)).toContainEqual({ x: 5, y: 5 });
  });

  test("駒のある升には打てない", () => {
    const drops = validator.getLegalDropsByKind(positionOf(WHITE_HOLDS_SILVER), Color.White, "GI");

    expect(drops.map((move) => move.to)).not.toContainEqual({ x: 2, y: 1 });
  });
});
