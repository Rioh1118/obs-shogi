import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * 状態遷移表の在庫と索引を突き合わせる
 *
 * `docs/state-transitions/README.md` は「未作成を消さないこと」と書いて在庫の一覧として
 * 使うことを宣言している。表を足したのに索引に書き忘れると、次に書く人が
 * 既存の表に気づかず重複した表を作る。実際に1件そうなった。
 */
// 起点は `walk.ts` が決める。`process.cwd()` にすると、ランナーの起動場所が
// 別の作業ツリーだったときに違う木の docs を読む
const DIR = join(REPO_ROOT, "docs/state-transitions");

describe("状態遷移表の索引", () => {
  test("README がすべての表を列挙している", () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .sort();
    const readme = readFileSync(join(DIR, "README.md"), "utf8");

    const missing = files.filter((f) => !readme.includes(`(${f})`));
    expect(missing).toEqual([]);
  });
});
