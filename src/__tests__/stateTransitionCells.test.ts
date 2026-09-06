import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { uncoveredCellsIn } from "./stateTransitionCells";
import { TABLES_DIR, tables } from "./stateTransitionIndex";

/**
 * 表が「遷移がある」と書いたセルは、踏むテストがあるか、埋まっていないセルとして
 * 名前が挙がっているかのどちらか。**黙って ✓ が無いセルを作らせない。**
 *
 * 機械に渡すのは、この形の見落としが「表を読んで現物と突き合わせる」でしか
 * 見つからないから。突き合わせは毎回は行われない。
 *
 * **記号の意味や遷移先の正しさはここでは見ない。** そこは読む人の仕事で、
 * 機械にできるのは「主張と一覧の突き合わせ」まで。
 */
describe("状態遷移表のセル", () => {
  test("遷移を書いたセルは、✓ を持つか「埋まっていないセル」に載っている", () => {
    const uncovered = tables()
      .filter((f) => f !== "README.md")
      .flatMap((file) => uncoveredCellsIn(file, readFileSync(join(TABLES_DIR, file), "utf8")))
      .map((c) => `${c.file}  (${c.state}, ${c.event})`);

    expect(
      uncovered,
      "遷移を書いたのに踏むテストが無い。テストを足して ✓ を付けるか、「埋まっていないセル」に挙げること",
    ).toEqual([]);
  });
});
