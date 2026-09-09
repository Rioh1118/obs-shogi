import { describe, expect, test } from "vitest";

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

/** 先手飛9三。9一と9二を往復すると、先手の手が毎回王手になる */
const ROOK_AND_KING = "8k/9/R8/9/9/9/9/9/4K4 b - 1";
const PERPETUAL_CHECK_CYCLE = ["1a1b", "9a9b", "1b1a", "9b9a"];
/** 同じ往復でも、飛が9三へ戻る形では先手の手の半分が王手にならない */
const HALF_CHECK_CYCLE = ["9c9a", "1a1b", "9a9c", "1b1a"];

/** 先手玉5二。5一へ上がるとトライが成立する */
const BEFORE_TRY = "9/4K4/9/9/9/9/9/9/k8 b - 1";
/** **先手玉が最初から5一に居る。** 歩を突いてもトライではない */
const KING_ALREADY_ON_TRY_SQUARE = "4K4/9/9/9/9/9/4P4/9/k8 b - 1";

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
      winner: "black",
    });
  });

  test("合法手が無く王手でもなければ手詰まり", () => {
    expect(judge({ startSfen: BEFORE_STALEMATE, usiMoves: ["8d8c"] })).toEqual({
      kind: "stalemate",
      winner: "black",
    });
  });

  describe("千日手", () => {
    test("同一局面が4回で千日手", () => {
      expect(judge({ startSfen: TWO_KINGS, usiMoves: repeat(KING_SHUFFLE, 3) })).toEqual({
        kind: "repetitionDraw",
        winner: null,
      });
    });

    test("同一局面が3回では終わらない", () => {
      expect(judge({ startSfen: TWO_KINGS, usiMoves: repeat(KING_SHUFFLE, 2) })).toBeNull();
    });

    test("連続王手なら、王手を続けた側の負け", () => {
      expect(
        judge({
          startSfen: ROOK_AND_KING,
          usiMoves: ["9c9a", ...repeat(PERPETUAL_CHECK_CYCLE, 3)],
        }),
      ).toEqual({ kind: "perpetualCheck", winner: "white" });
    });

    test("王手が途切れていれば引き分け", () => {
      expect(judge({ startSfen: ROOK_AND_KING, usiMoves: repeat(HALF_CHECK_CYCLE, 3) })).toEqual({
        kind: "repetitionDraw",
        winner: null,
      });
    });

    test("最大手数より先に立つ", () => {
      expect(
        judge(
          { startSfen: TWO_KINGS, usiMoves: repeat(KING_SHUFFLE, 3) },
          { jishogiRule: "none", maxMoves: 12 },
        ),
      ).toEqual({ kind: "repetitionDraw", winner: null });
    });
  });

  describe("トライルール", () => {
    test("設定が try なら、玉が相手玉の初期位置に着いた時点で勝ち", () => {
      expect(
        judge({ startSfen: BEFORE_TRY, usiMoves: ["5b5a"] }, { jishogiRule: "try", maxMoves: 0 }),
      ).toEqual({ kind: "tryRule", winner: "black" });
    });

    test("設定が try でなければ同じ局面でも終わらない", () => {
      expect(
        judge(
          { startSfen: BEFORE_TRY, usiMoves: ["5b5a"] },
          { jishogiRule: "general27", maxMoves: 0 },
        ),
      ).toBeNull();
    });

    test("玉が既にその地点に居るだけでは成立しない", () => {
      expect(
        judge(
          { startSfen: KING_ALREADY_ON_TRY_SQUARE, usiMoves: ["5g5f"] },
          { jishogiRule: "try", maxMoves: 0 },
        ),
      ).toBeNull();
    });

    test("1手も指していない局面では成立しない", () => {
      expect(
        judge(
          { startSfen: KING_ALREADY_ON_TRY_SQUARE, usiMoves: [] },
          { jishogiRule: "try", maxMoves: 0 },
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

    test.each([[0], [-1], [Number.NaN]])("%p は上限なしとして扱う", (maxMoves) => {
      expect(
        judge(
          { startSfen: TWO_KINGS, usiMoves: KING_SHUFFLE.slice(0, 2) },
          { jishogiRule: "none", maxMoves },
        ),
      ).toBeNull();
    });

    test("詰みの方が先に立つ", () => {
      expect(
        judge(
          { startSfen: BEFORE_CHECKMATE, usiMoves: ["6c5b"] },
          { ...DEFAULT_GAME_RULES, maxMoves: 1 },
        ),
      ).toEqual({ kind: "checkmate", winner: "black" });
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

    test("指せない手が混ざっている。何手目と、その直前の局面を返す", () => {
      const error: GameOutcomeFailure = {
        code: "unplayable_move",
        usiMove: "9i8i",
        ply: 2,
        sfen: "4k4/9/9/9/9/9/9/9/5K3 w - 1",
      };
      expect(
        judgeGameOutcome({ startSfen: TWO_KINGS, usiMoves: ["5i4i", "9i8i"] }, NO_LIMIT),
      ).toEqual({ success: false, error });
    });

    test("綴りは読めるが指せない手でも、直前の局面を返す", () => {
      // 玉が2マス動く手。駒はあるので `createMoveByUSI` は通り、合法手の検査で落ちる
      const result = judgeGameOutcome({ startSfen: TWO_KINGS, usiMoves: ["5i3i"] }, NO_LIMIT);
      expect(result).toEqual({
        success: false,
        error: { code: "unplayable_move", usiMove: "5i3i", ply: 1, sfen: TWO_KINGS },
      });
    });

    test("USI の綴りに余りが付いていたら、読める分だけ採らずに断る", () => {
      const result = judgeGameOutcome({ startSfen: TWO_KINGS, usiMoves: ["5i4i4i"] }, NO_LIMIT);
      expect(result).toEqual({
        success: false,
        error: { code: "unplayable_move", usiMove: "5i4i4i", ply: 1, sfen: TWO_KINGS },
      });
    });
  });
});
