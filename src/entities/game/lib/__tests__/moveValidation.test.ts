import { describe, expect, test } from "vitest";
import { Color, Shogi, type Kind } from "shogi.js";

import {
  canPromote,
  getAllLegalMoves,
  getLegalDrops,
  getLegalMovesFrom,
  hasLegalMove,
  mustPromote,
  wouldBeInCheckAfterMove,
} from "../moveValidation";

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

describe("getAllLegalMoves", () => {
  test("平手初期局面の合法手は30手", () => {
    expect(getAllLegalMoves(positionOf(HIRATE), Color.Black)).toHaveLength(30);
  });

  test("打ち歩詰めになる歩打ちは含まない", () => {
    const moves = getAllLegalMoves(positionOf(UCHIFUDUME), Color.Black);

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
  ])("%s で getAllLegalMoves と答えが一致する", (_name, sfen, color) => {
    expect(hasLegalMove(positionOf(sfen), color)).toBe(
      getAllLegalMoves(positionOf(sfen), color).length > 0,
    );
  });

  // 手番でない側を渡すと shogi.js が手番違いを投げ、`wouldBeInCheckAfterMove` の
  // catch が「王手放置」に倒すので、平手初期局面でも「合法手なし」になる。
  // **エラーにはならない**ので、呼び出し側が取り違えると詰みと区別が付かない
  test("手番でない側を渡すと、エラーではなく「合法手なし」が返る", () => {
    expect(hasLegalMove(positionOf(HIRATE), Color.White)).toBe(false);
  });
});

/** 駒打ちの候補を `筋段` の綴りで並べる。順序に意味は無いので揃えて比べる */
function dropSquares(sfen: string, color: Color, kind: Kind): string[] {
  return getLegalDrops(positionOf(sfen), color, kind)
    .map((move) => `${move.to.x}${move.to.y}`)
    .sort();
}

/** `kind` を打てる段を並べる。5筋だけを見れば、段の規則が足りる */
function dropRanks(sfen: string, color: Color, kind: Kind): number[] {
  return dropSquares(sfen, color, kind)
    .filter((square) => square.startsWith("5"))
    .map((square) => Number(square[1]));
}

const EMPTY_BOARD_KINGS = "7k1/9/9/9/9/9/9/9/1K7";

describe("getLegalDrops", () => {
  test.each([
    [
      "先手の歩は1段目に打てない",
      `${EMPTY_BOARD_KINGS} b P 1`,
      Color.Black,
      "FU",
      [2, 3, 4, 5, 6, 7, 8, 9],
    ],
    [
      "後手の歩は9段目に打てない",
      `${EMPTY_BOARD_KINGS} w p 1`,
      Color.White,
      "FU",
      [1, 2, 3, 4, 5, 6, 7, 8],
    ],
    [
      "先手の香は1段目に打てない",
      `${EMPTY_BOARD_KINGS} b L 1`,
      Color.Black,
      "KY",
      [2, 3, 4, 5, 6, 7, 8, 9],
    ],
    [
      "後手の香は9段目に打てない",
      `${EMPTY_BOARD_KINGS} w l 1`,
      Color.White,
      "KY",
      [1, 2, 3, 4, 5, 6, 7, 8],
    ],
    [
      "先手の桂は1、2段目に打てない",
      `${EMPTY_BOARD_KINGS} b N 1`,
      Color.Black,
      "KE",
      [3, 4, 5, 6, 7, 8, 9],
    ],
    [
      "後手の桂は8、9段目に打てない",
      `${EMPTY_BOARD_KINGS} w n 1`,
      Color.White,
      "KE",
      [1, 2, 3, 4, 5, 6, 7],
    ],
    [
      "銀はどの段にも打てる",
      `${EMPTY_BOARD_KINGS} b S 1`,
      Color.Black,
      "GI",
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ],
    [
      "金はどの段にも打てる",
      `${EMPTY_BOARD_KINGS} w g 1`,
      Color.White,
      "KI",
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ],
    [
      "角はどの段にも打てる",
      `${EMPTY_BOARD_KINGS} b B 1`,
      Color.Black,
      "KA",
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ],
    [
      "飛はどの段にも打てる",
      `${EMPTY_BOARD_KINGS} w r 1`,
      Color.White,
      "HI",
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ],
  ] as const)("%s", (_name, sfen, color, kind, ranks) => {
    expect(dropRanks(sfen, color, kind)).toEqual(ranks);
  });

  test("味方の歩がある筋には歩を打てない", () => {
    const squares = dropSquares("7k1/9/9/9/9/9/4P4/9/1K7 b P 1", Color.Black, "FU");

    expect(squares.some((square) => square.startsWith("5"))).toBe(false);
    expect(squares.some((square) => square.startsWith("4"))).toBe(true);
  });

  test("相手の歩がある筋には歩を打てる", () => {
    const squares = dropSquares("7k1/9/9/9/9/4p4/9/9/1K7 b P 1", Color.Black, "FU");

    expect(squares.some((square) => square.startsWith("5"))).toBe(true);
  });

  test("と金がある筋には歩を打てる", () => {
    const squares = dropSquares("7k1/9/9/9/9/9/4+P4/9/1K7 b P 1", Color.Black, "FU");

    expect(squares.some((square) => square.startsWith("5"))).toBe(true);
  });

  test("駒がある升には打てない", () => {
    expect(dropSquares("7k1/9/9/9/9/4p4/9/9/1K7 b S 1", Color.Black, "GI")).not.toContain("56");
  });

  test("持っていない駒は打てない", () => {
    expect(getLegalDrops(positionOf(`${EMPTY_BOARD_KINGS} b S 1`), Color.Black, "FU")).toEqual([]);
  });

  test.each(["OU", "TO", "RY"] as const)("%s は打てない", (kind) => {
    expect(getLegalDrops(positionOf(`${EMPTY_BOARD_KINGS} b SP 1`), Color.Black, kind)).toEqual([]);
  });

  test("先手の打ち歩詰めを除く", () => {
    const squares = dropSquares(UCHIFUDUME, Color.Black, "FU");

    expect(squares).not.toContain("52");
    expect(squares.length).toBeGreaterThan(0);
  });

  test("後手の打ち歩詰めを除く", () => {
    // `UCHIFUDUME` の先後を入れ替えた局面
    const squares = dropSquares("k2l1l3/9/9/9/9/9/4g4/9/4K4 w p 1", Color.White, "FU");

    expect(squares).not.toContain("58");
    expect(squares.length).toBeGreaterThan(0);
  });

  test("詰まない歩打ちの王手は打てる", () => {
    // 5二の歩は玉の横へ逃げられるので打ち歩詰めではない
    expect(dropSquares("4k4/9/4G4/9/9/9/9/9/7K1 b P 1", Color.Black, "FU")).toContain("52");
  });

  test("王手を解かない駒打ちを除く", () => {
    // 飛の王手。間駒になる3升だけが残る
    expect(dropSquares("7k1/9/9/9/4r4/9/9/9/4K4 b S 1", Color.Black, "GI")).toEqual([
      "56",
      "57",
      "58",
    ]);
  });

  test("手番でない側は打てない", () => {
    expect(getLegalDrops(positionOf(`${EMPTY_BOARD_KINGS} b S 1`), Color.White, "GI")).toEqual([]);
  });
});

describe("getLegalMovesFrom", () => {
  test("動ける升だけを返す", () => {
    const moves = getLegalMovesFrom(positionOf(HIRATE), 7, 7);

    expect(moves.map((move) => move.to)).toEqual([{ x: 7, y: 6 }]);
  });

  test("味方に囲まれた駒は空を返す", () => {
    expect(getLegalMovesFrom(positionOf(HIRATE), 8, 8)).toEqual([]);
  });

  test("手番でない側の駒は空を返す", () => {
    expect(getLegalMovesFrom(positionOf(HIRATE), 3, 3)).toEqual([]);
  });

  test("動かすと王手放置になる手を除く", () => {
    const pinned = "7k1/9/9/9/4r4/9/4S4/4K4/9 b - 1";
    const moves = getLegalMovesFrom(positionOf(pinned), 5, 7);

    expect(moves.map((move) => move.to)).toEqual([{ x: 5, y: 6 }]);
  });

  test("駒の無い升は空を返す", () => {
    expect(getLegalMovesFrom(positionOf(HIRATE), 5, 5)).toEqual([]);
  });
});

describe("getLegalDrops の色", () => {
  const WHITE_HOLDS_SILVER = "7k1/9/9/9/9/9/9/9/1K7 w s 1";

  /** `Color.Black` は `0` なので、色の有無を真偽で見ると先手の駒打ちだけが全て断られる */
  test("先手の持ち駒を打てる", () => {
    const drops = getLegalDrops(positionOf("7k1/9/9/9/9/9/9/9/1K7 b S 1"), Color.Black, "GI");

    expect(drops.map((move) => move.to)).toContainEqual({ x: 5, y: 5 });
  });

  test("後手の持ち駒を打てる", () => {
    const drops = getLegalDrops(positionOf(WHITE_HOLDS_SILVER), Color.White, "GI");

    expect(drops.map((move) => move.to)).toContainEqual({ x: 5, y: 5 });
  });

  test("駒のある升には打てない", () => {
    const drops = getLegalDrops(positionOf(WHITE_HOLDS_SILVER), Color.White, "GI");

    expect(drops.map((move) => move.to)).not.toContainEqual({ x: 2, y: 1 });
  });
});

describe("wouldBeInCheckAfterMove", () => {
  /** 先手銀5七が飛に釘付けにされている。5八の玉へ通る筋を外せば王手放置になる */
  const BLACK_PINNED = "7k1/9/9/9/4r4/9/4S4/4K4/9 b - 1";
  /** 上の局面の先後を入れ替えたもの */
  const WHITE_PINNED = "9/4k4/4s4/9/4R4/9/9/9/1K7 w - 1";

  test.each([
    ["先手が筋を外す", BLACK_PINNED, { x: 5, y: 7 }, { x: 4, y: 6 }, undefined, true],
    ["先手が筋の上を進む", BLACK_PINNED, { x: 5, y: 7 }, { x: 5, y: 6 }, undefined, false],
    ["後手が筋を外す", WHITE_PINNED, { x: 5, y: 3 }, { x: 4, y: 4 }, undefined, true],
    ["後手が筋の上を進む", WHITE_PINNED, { x: 5, y: 3 }, { x: 5, y: 4 }, undefined, false],
    ["手に色が付いた先手の手", BLACK_PINNED, { x: 5, y: 7 }, { x: 4, y: 6 }, Color.Black, true],
    ["手に色が付いた後手の手", WHITE_PINNED, { x: 5, y: 3 }, { x: 4, y: 4 }, Color.White, true],
  ])("%s", (_name, sfen, from, to, color, expected) => {
    expect(wouldBeInCheckAfterMove(positionOf(sfen), { from, to, color })).toBe(expected);
  });

  test("元の局面を動かさない", () => {
    const shogi = positionOf(BLACK_PINNED);
    const before = shogi.toSFENString();

    wouldBeInCheckAfterMove(shogi, { from: { x: 5, y: 7 }, to: { x: 5, y: 6 } });

    expect(shogi.toSFENString()).toBe(before);
  });

  test("指せない手は王手放置と同じ扱いで断る", () => {
    const shogi = positionOf(BLACK_PINNED);

    expect(wouldBeInCheckAfterMove(shogi, { from: { x: 1, y: 1 }, to: { x: 1, y: 2 } })).toBe(true);
  });
});

/** 空の盤に駒を1枚だけ置いた局面。成りの判定は玉も手番も見ない */
function loneMover(piece: string, x: number, y: number): Shogi {
  const rows = Array.from({ length: 9 }, () => "9");
  rows[y - 1] = `${9 - x > 0 ? 9 - x : ""}${piece}${x - 1 > 0 ? x - 1 : ""}`;
  return positionOf(`${rows.join("/")} b - 1`);
}

describe("canPromote", () => {
  test.each([
    ["先手の歩が敵陣へ入る", "P", 5, 4, 3, true],
    ["先手の歩が敵陣の手前で止まる", "P", 5, 5, 4, false],
    ["先手の銀が敵陣から出る", "S", 5, 3, 4, true],
    ["先手の銀が敵陣の中を動く", "S", 5, 2, 3, true],
    ["後手の歩が敵陣へ入る", "p", 5, 6, 7, true],
    ["後手の歩が敵陣の手前で止まる", "p", 5, 5, 6, false],
    ["後手の銀が敵陣から出る", "s", 5, 7, 6, true],
    ["金は成れない", "G", 5, 4, 3, false],
    ["玉は成れない", "K", 5, 4, 3, false],
    ["と金は成れない", "+P", 5, 4, 3, false],
    ["龍は成れない", "+R", 5, 4, 3, false],
  ])("%s", (_name, piece, x, fromY, toY, expected) => {
    const move = { from: { x, y: fromY }, to: { x, y: toY } };
    expect(canPromote(loneMover(piece, x, fromY), move)).toBe(expected);
  });

  test.each(["P", "L", "N", "S", "B", "R"])("%s は成れる駒", (piece) => {
    const move = { from: { x: 5, y: 4 }, to: { x: 5, y: 3 } };
    expect(canPromote(loneMover(piece, 5, 4), move)).toBe(true);
  });

  test("駒打ちは成れない", () => {
    expect(canPromote(loneMover("P", 5, 4), { to: { x: 5, y: 3 }, kind: "FU" })).toBe(false);
  });

  test("駒の無い升からは成れない", () => {
    const move = { from: { x: 1, y: 4 }, to: { x: 1, y: 3 } };
    expect(canPromote(loneMover("P", 5, 4), move)).toBe(false);
  });
});

describe("mustPromote", () => {
  test.each([
    ["先手の歩が1段目へ", "P", 2, 1, true],
    ["先手の歩が2段目へ", "P", 3, 2, false],
    ["先手の香が1段目へ", "L", 3, 1, true],
    ["先手の香が2段目へ", "L", 3, 2, false],
    ["先手の桂が2段目へ", "N", 4, 2, true],
    ["先手の桂が1段目へ", "N", 3, 1, true],
    ["先手の桂が3段目へ", "N", 5, 3, false],
    ["後手の歩が9段目へ", "p", 8, 9, true],
    ["後手の歩が8段目へ", "p", 7, 8, false],
    ["後手の香が9段目へ", "l", 7, 9, true],
    ["後手の桂が8段目へ", "n", 6, 8, true],
    ["後手の桂が9段目へ", "n", 7, 9, true],
    ["後手の桂が7段目へ", "n", 5, 7, false],
    ["銀は行き所を失わない", "S", 2, 1, false],
    ["と金は行き所を失わない", "+P", 2, 1, false],
  ])("%s", (_name, piece, fromY, toY, expected) => {
    const move = { from: { x: 5, y: fromY }, to: { x: 5, y: toY } };
    expect(mustPromote(loneMover(piece, 5, fromY), move)).toBe(expected);
  });

  test("駒打ちは成らない", () => {
    expect(mustPromote(loneMover("P", 5, 4), { to: { x: 5, y: 1 }, kind: "FU" })).toBe(false);
  });

  test("駒の無い升からは成らない", () => {
    const move = { from: { x: 1, y: 2 }, to: { x: 1, y: 1 } };
    expect(mustPromote(loneMover("P", 5, 4), move)).toBe(false);
  });
});
