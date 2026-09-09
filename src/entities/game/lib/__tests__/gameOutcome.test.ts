import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";

import {
  judgeGameOutcome,
  type GameOutcome,
  type GameOutcomeFailure,
  type GameProgress,
} from "../gameOutcome";
import { DEFAULT_GAME_RULES, type GameRules } from "../gameRules";

/** 上限を見ない設定。最大手数だけを見たい試験は個別に `maxMoves` を入れる */
const NO_LIMIT: GameRules = { jishogiRule: "none", maxMoves: 0 };

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

/** 先手金6三を5二へ寄せると頭金。歩5三がその金を支える */
const BEFORE_CHECKMATE = "4k4/9/3GP4/9/9/9/9/9/4K4 b - 1";

/**
 * 先手銀8四を8三へ上がると、後手玉9一の行き先（9二・8一・8二）が
 * 銀8三と金7二で全て塞がる。**どちらも9一には利いていない**ので王手にはならない
 */
const BEFORE_STALEMATE = "k8/2G6/9/1S7/9/9/9/9/4K4 b - 1";

/** 玉が2枚だけ。4手で元の局面に戻る */
const TWO_KINGS = "4k4/9/9/9/9/9/9/9/4K4 b - 1";
const KING_SHUFFLE = ["5i4i", "5a4a", "4i5i", "4a5a"];

/** 先手飛9三。9一へ寄って王手を掛け、以後は9一と9二を往復して掛け続ける */
const BEFORE_PERPETUAL_CHECK = "8k/9/R8/9/9/9/9/9/4K4 b - 1";
const PERPETUAL_CHECK_CYCLE = ["1a1b", "9a9b", "1b1a", "9b9a"];

/** 先手玉5二。5一へ上がるとトライが成立する */
const BEFORE_TRY = "9/4K4/9/9/9/9/9/9/k8 b - 1";

function judge(progress: GameProgress, rules: GameRules = NO_LIMIT): GameOutcome | null {
  const result = judgeGameOutcome(progress, rules);
  if (!result.success) throw new Error(`判定できなかった: ${JSON.stringify(result.error)}`);
  return result.data;
}

function repeat<T>(items: T[], times: number): T[] {
  return Array.from({ length: times }, () => items).flat();
}

describe("judgeGameOutcome", () => {
  test("平手初期局面はまだ終わっていない", () => {
    expect(judge({ startSfen: HIRATE, usiMoves: [] })).toBeNull();
  });

  test("詰み", () => {
    expect(judge({ startSfen: BEFORE_CHECKMATE, usiMoves: ["6c5b"] })).toEqual({
      kind: "checkmate",
      winner: Color.Black,
    });
  });

  test("合法手が無く王手でもなければ手詰まり", () => {
    expect(judge({ startSfen: BEFORE_STALEMATE, usiMoves: ["8d8c"] })).toEqual({
      kind: "stalemate",
      winner: Color.Black,
    });
  });

  test("同一局面が4回で千日手", () => {
    expect(judge({ startSfen: TWO_KINGS, usiMoves: repeat(KING_SHUFFLE, 3) })).toEqual({
      kind: "repetitionDraw",
      winner: null,
    });
  });

  test("同一局面が3回では終わらない", () => {
    expect(judge({ startSfen: TWO_KINGS, usiMoves: repeat(KING_SHUFFLE, 2) })).toBeNull();
  });

  test("連続王手の千日手は、王手を続けた側の負け", () => {
    expect(
      judge({
        startSfen: BEFORE_PERPETUAL_CHECK,
        usiMoves: ["9c9a", ...repeat(PERPETUAL_CHECK_CYCLE, 3)],
      }),
    ).toEqual({ kind: "perpetualCheck", winner: Color.White });
  });

  describe("トライルール", () => {
    test("設定が try なら、玉が相手玉の初期位置に着いた時点で勝ち", () => {
      expect(
        judge({ startSfen: BEFORE_TRY, usiMoves: ["5b5a"] }, { jishogiRule: "try", maxMoves: 0 }),
      ).toEqual({ kind: "tryRule", winner: Color.Black });
    });

    test("設定が try でなければ同じ局面でも終わらない", () => {
      expect(
        judge(
          { startSfen: BEFORE_TRY, usiMoves: ["5b5a"] },
          { jishogiRule: "general27", maxMoves: 0 },
        ),
      ).toBeNull();
    });
  });

  describe("最大手数", () => {
    test("達したら引き分け", () => {
      expect(
        judge(
          { startSfen: TWO_KINGS, usiMoves: KING_SHUFFLE.slice(0, 2) },
          { jishogiRule: "none", maxMoves: 2 },
        ),
      ).toEqual({ kind: "maxMoves", winner: null });
    });

    test("届いていなければ終わらない", () => {
      expect(
        judge(
          { startSfen: TWO_KINGS, usiMoves: KING_SHUFFLE.slice(0, 2) },
          { jishogiRule: "none", maxMoves: 3 },
        ),
      ).toBeNull();
    });

    test("0 なら上限なし", () => {
      expect(
        judge(
          { startSfen: TWO_KINGS, usiMoves: KING_SHUFFLE.slice(0, 2) },
          { jishogiRule: "none", maxMoves: 0 },
        ),
      ).toBeNull();
    });

    test("詰みの方が先に立つ", () => {
      expect(
        judge(
          { startSfen: BEFORE_CHECKMATE, usiMoves: ["6c5b"] },
          { ...DEFAULT_GAME_RULES, maxMoves: 1 },
        ),
      ).toEqual({ kind: "checkmate", winner: Color.Black });
    });
  });

  describe("局面を組み立てられないとき", () => {
    test("根の SFEN が読めない", () => {
      const error: GameOutcomeFailure = { code: "unplayable_start_sfen", startSfen: "startpos" };
      expect(judgeGameOutcome({ startSfen: "startpos", usiMoves: [] }, NO_LIMIT)).toEqual({
        success: false,
        error,
      });
    });

    test("指せない手が混ざっている。何手目かを返す", () => {
      const error: GameOutcomeFailure = { code: "unplayable_move", usiMove: "9i8i", ply: 2 };
      expect(
        judgeGameOutcome({ startSfen: TWO_KINGS, usiMoves: ["5i4i", "9i8i"] }, NO_LIMIT),
      ).toEqual({ success: false, error });
    });
  });
});
