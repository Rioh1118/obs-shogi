import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { scanCells } from "./stateTransitionCells";
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
const scanned = () =>
  tables()
    .filter((f) => f !== "README.md")
    .map((file) => scanCells(file, readFileSync(join(TABLES_DIR, file), "utf8")));

describe("状態遷移表のセル", () => {
  test("遷移を書いたセルは、✓ を持つか「埋まっていないセル」に載っている", () => {
    const uncovered = scanned()
      .flatMap((r) => r.uncovered)
      .map((c) => `${c.file}  (${c.state}, ${c.event})`);

    expect(
      uncovered,
      "遷移を書いたのに踏むテストが無い。テストを足して ✓ を付けるか、「埋まっていないセル」に挙げること",
    ).toEqual([]);
  });

  /**
   * **0件の指摘と、0セルしか見ていないことを区別する。**
   *
   * 行を拾う綴りは表の書き方に依るので、書き方が変われば無言で0セットになる。
   * 上のテストは `toEqual([])` なのでそのとき緑のまま通り、**検査が消えたことに
   * 誰も気づかない。** 見たセルの数を下限で固定して、空回りを緑にしない。
   */
  test("掛けている表を、実際に読めている", () => {
    const inspected = scanned().reduce((n, r) => n + r.inspected, 0);

    expect(inspected, "表の書き方が変わって、走査が読めなくなっている").toBeGreaterThan(30);
  });
});
