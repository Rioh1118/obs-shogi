import { describe, expect, test } from "vitest";
import { KIFU_FORMAT_OPTIONS, kifuFileName } from "../kifu";

/**
 * 書き込むファイル名の作り方
 *
 * 作る面が3つある（盤で組む・棋譜を貼る・課題局面から）ので、規則を写すと
 * どれかが別の綴りになる。ここが唯一の出典。
 */
describe("kifuFileName", () => {
  test("選んだ形式が拡張子になる", () => {
    expect(kifuFileName("45角戦法", "kif")).toBe("45角戦法.kif");
    expect(kifuFileName("45角戦法", "csa")).toBe("45角戦法.csa");
  });

  test("打った拡張子は二重に付かない", () => {
    expect(kifuFileName("45角戦法.kif", "kif")).toBe("45角戦法.kif");
  });

  test("打った拡張子と選んだ形式が違っても、選んだほうが勝つ", () => {
    expect(kifuFileName("棋譜.kif", "csa")).toBe("棋譜.csa");
  });

  test("大文字で打った拡張子も落とす", () => {
    expect(kifuFileName("棋譜.KIF", "kif")).toBe("棋譜.kif");
  });

  test("末尾以外の拡張子は名前の一部として残す", () => {
    expect(kifuFileName("第1局.kif の控え", "kif")).toBe("第1局.kif の控え.kif");
  });

  test("名前が空なら空。送る側はこれで押せないと判定する", () => {
    expect(kifuFileName("", "kif")).toBe("");
    expect(kifuFileName("   ", "kif")).toBe("");
  });

  test("拡張子しか打たれていなければ空。`.kif` という名前のファイルを作らない", () => {
    expect(kifuFileName(".kif", "kif")).toBe("");
  });

  test("落とす綴りは選択肢から作る。形式を足したらここも増える", () => {
    for (const { value } of KIFU_FORMAT_OPTIONS) {
      expect(kifuFileName(`棋譜.${value}`, "kif")).toBe("棋譜.kif");
    }
  });
});
