import { describe, expect, test } from "vitest";
import { Color } from "shogi.js";

import {
  judgeDeclaration,
  type DeclarationFailure,
  type DeclarationJudgment,
} from "../jishogiDeclaration";
import type { JishogiRule } from "../gameRules";

/**
 * 先手が宣言できる形。玉5一、敵陣の駒は玉を除いて10枚、持ち駒とあわせて28点。
 *
 * 28点は**先手の宣言が通る下限**（後手なら27点で通る）。1点減らした
 * `DECLARABLE_27` と対にしてある
 */
const DECLARABLE_28 = "4K4/RBGS4P/RBNLP4/9/9/9/9/9/4k4 b 2P 1";

/** `DECLARABLE_28` から持ち駒の歩を1枚減らして27点にした形 */
const DECLARABLE_27 = "4K4/RBGS4P/RBNLP4/9/9/9/9/9/4k4 b P 1";

function judge(sfen: string, color: Color, rule: JishogiRule): DeclarationJudgment {
  const result = judgeDeclaration(sfen, color, rule);
  if (!result.success) throw new Error(`判定できなかった: ${JSON.stringify(result.error)}`);
  return result.data;
}

describe("judgeDeclaration", () => {
  test.each<[JishogiRule]>([["none"], ["try"]])("設定が %s なら宣言そのものが起きない", (rule) => {
    expect(judge(DECLARABLE_28, Color.Black, rule)).toBe("unavailable");
  });

  describe("27点法", () => {
    test("先手は28点で勝ち", () => {
      expect(judge(DECLARABLE_28, Color.Black, "general27")).toBe("win");
    });

    test("先手は27点では負け", () => {
      expect(judge(DECLARABLE_27, Color.Black, "general27")).toBe("lose");
    });
  });

  describe("24点法", () => {
    test("24点以上31点未満は引き分け", () => {
      expect(judge(DECLARABLE_28, Color.Black, "general24")).toBe("draw");
    });
  });

  test("手番でない側の宣言は負け", () => {
    expect(judge(DECLARABLE_28, Color.White, "general27")).toBe("lose");
  });

  test("SFEN が読めなければ判定しない", () => {
    const error: DeclarationFailure = { code: "unplayable_sfen", sfen: "startpos" };
    expect(judgeDeclaration("startpos", Color.Black, "general27")).toEqual({
      success: false,
      error,
    });
  });
});
