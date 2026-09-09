import { describe, expect, test } from "vitest";

import {
  judgeDeclaration,
  type DeclarationFailure,
  type DeclarationJudgment,
} from "../jishogiDeclaration";
import type { JishogiRule } from "../gameRules";
import type { Side } from "@/entities/game-session";

/**
 * 先手が宣言できる形。玉5一、敵陣の駒は玉を除いて10枚、持ち駒とあわせて28点。
 *
 * 28点は**先手の宣言が通る下限**。1点減らした `DECLARABLE_27` と対にしてある
 */
const DECLARABLE_28 = "4K4/RBGS4P/RBNLP4/9/9/9/9/9/4k4 b 2P 1";

/** `DECLARABLE_28` から持ち駒の歩を1枚減らして27点にした形 */
const DECLARABLE_27 = "4K4/RBGS4P/RBNLP4/9/9/9/9/9/4k4 b P 1";

/**
 * 敵陣の駒数（10枚）と入玉は満たすが、小駒だけなので10点しかない形。
 *
 * **枚数の条件と点数の条件を分けて当てるためにある**——`DECLARABLE_*` を
 * 削って作ると、先に枚数の条件で落ちて点数の側が試されない
 */
const TEN_PIECES_TEN_POINTS = "4K4/8G/GSNLPPPPP/9/9/9/9/9/4k4 b - 1";

function judge(sfen: string, side: Side, rule: JishogiRule): DeclarationJudgment {
  const result = judgeDeclaration(sfen, side, rule);
  if (!result.success) throw new Error(`判定できなかった: ${JSON.stringify(result.error)}`);
  return result.data;
}

describe("judgeDeclaration", () => {
  test.each<[JishogiRule]>([["none"], ["try"]])("設定が %s なら宣言そのものが起きない", (rule) => {
    expect(judge(DECLARABLE_28, "black", rule)).toBe("unavailable");
  });

  describe("27点法", () => {
    test("先手は28点で勝ち", () => {
      expect(judge(DECLARABLE_28, "black", "general27")).toBe("win");
    });

    test("先手は27点では負け", () => {
      expect(judge(DECLARABLE_27, "black", "general27")).toBe("lose");
    });
  });

  describe("24点法", () => {
    test("24点以上31点未満は引き分け", () => {
      expect(judge(DECLARABLE_28, "black", "general24")).toBe("draw");
    });

    test("24点未満は負け", () => {
      expect(judge(TEN_PIECES_TEN_POINTS, "black", "general24")).toBe("lose");
    });
  });

  test("手番でない側の宣言は負け", () => {
    expect(judge(DECLARABLE_28, "white", "general27")).toBe("lose");
  });

  test("SFEN が読めなければ判定しない", () => {
    const error: DeclarationFailure = { code: "unplayable_sfen", sfen: "startpos" };
    expect(judgeDeclaration("startpos", "black", "general27")).toEqual({
      success: false,
      error,
    });
  });
});
