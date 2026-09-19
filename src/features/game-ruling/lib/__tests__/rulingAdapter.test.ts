import { describe, expect, test, vi } from "vitest";
import { Record as ShogiRecord } from "tsshogi";
import type { GameRules } from "@/entities/game";
import { createRulingAdapter } from "../rulingAdapter";

/**
 * 実物の裁定器。**対局の進行の試験は偽物を差し替えている**ので、
 * 「判定の答えを、棋譜と画面に残る綴りへどう写すか」を見るのはここだけ。
 *
 * 綴りそのものを固定するのは、**`endGameByRule` に渡した `detail` が棋譜に残る**ため
 * （`docs/spec/features/game-play.md`）。判定の正しさは `entities/game` の側が見る。
 */

const HIRATE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const RULES: GameRules = { jishogiRule: "general27", maxMoves: 0 };

/** 玉2枚だけを往復させる。4手で元の局面に戻るので、4周すると千日手に当たる */
const KING_SHUFFLE = "4k4/9/9/9/9/9/9/9/4K4 b - 1";
const CYCLE = ["5i4i", "5a4a", "4i5i", "4a5a"];

describe("裁定器", () => {
  test("終わっていなければ「続く」", () => {
    const ruling = createRulingAdapter(RULES);

    expect(ruling.judge({ startSfen: HIRATE, usiMoves: ["7g7f"] })).toEqual({ kind: "continue" });
  });

  test("最大手数は引き分け。**勝者を付けない**", () => {
    const ruling = createRulingAdapter({ jishogiRule: "none", maxMoves: 2 });

    expect(ruling.judge({ startSfen: HIRATE, usiMoves: ["7g7f", "3c3d"] })).toEqual({
      kind: "over",
      winner: null,
      detail: "最大手数",
    });
  });

  test("千日手は引き分け", () => {
    const ruling = createRulingAdapter(RULES);
    const usiMoves = Array.from({ length: 16 }, (_, i) => CYCLE[i % CYCLE.length]);

    expect(ruling.judge({ startSfen: KING_SHUFFLE, usiMoves })).toEqual({
      kind: "over",
      winner: null,
      detail: "千日手",
    });
  });

  /**
   * **「続く」を返さない。** 落ち方はその局面に固定されているので、
   * 次の手でも同じ結果になり、詰みも千日手も二度と立たない。
   */
  test("開始局面を読めなければ終局として畳む", () => {
    const ruling = createRulingAdapter(RULES);

    expect(ruling.judge({ startSfen: "こわれた sfen", usiMoves: [] })).toEqual({
      kind: "over",
      winner: null,
      detail: "開始局面を読めないため終局にしました",
    });
  });

  test("指せない手があれば、何手目かを残して畳む", () => {
    const ruling = createRulingAdapter(RULES);

    expect(ruling.judge({ startSfen: HIRATE, usiMoves: ["7g7f", "9i9z"] })).toEqual({
      kind: "over",
      winner: null,
      detail: "2手目（9i9z）を指せないため終局にしました",
    });
  });

  /**
   * **1つの裁定器を対局の間ずっと使う**ので、落ちた後も呼ばれ続ける。
   * 積みかけの棋譜が残っていると、次の裁定が「続き」だと思って更に積む。
   */
  test("落ちた後でも、新しい対局を正しく裁定する", () => {
    const ruling = createRulingAdapter(RULES);

    ruling.judge({ startSfen: HIRATE, usiMoves: ["9i9z"] });

    expect(ruling.judge({ startSfen: HIRATE, usiMoves: ["7g7f"] })).toEqual({ kind: "continue" });
  });

  /**
   * **判定器を持ち回っていることを、アダプタの側でも固定する。**
   * `entities/game` の側だけを見ていると、ここが `judgeGameOutcome`（根から組み直す）へ
   * 戻る変更を1つも止められない —— 実測で400手 15ms → 624ms の差がそこに出る。
   */
  test("毎手の裁定が、棋譜を根から組み直さない", () => {
    const ruling = createRulingAdapter(RULES);
    const plies = 60;

    let appends = 0;
    const original = ShogiRecord.prototype.append;
    const spy = vi.spyOn(ShogiRecord.prototype, "append").mockImplementation(function (
      this: ShogiRecord,
      ...args: Parameters<typeof original>
    ) {
      appends++;
      return original.apply(this, args);
    });

    try {
      const usiMoves: string[] = [];
      for (let ply = 0; ply < plies; ply++) {
        usiMoves.push(CYCLE[ply % CYCLE.length]);
        ruling.judge({ startSfen: KING_SHUFFLE, usiMoves: [...usiMoves] });
      }
    } finally {
      spy.mockRestore();
    }

    // 組み直す形なら n(n+1)/2 = 1830 回になる
    expect(appends).toBeLessThanOrEqual(plies * 2);
    // 走査が空振りして0回を「速い」と読まないための下限
    expect(appends).toBeGreaterThanOrEqual(plies);
  });
});
