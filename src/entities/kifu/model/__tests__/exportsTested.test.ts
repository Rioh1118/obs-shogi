import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cursorModule from "../cursor";
import * as branchModule from "../branch";
import * as jkfModule from "../jkf";
import * as kifuModule from "../kifu";

/**
 * `entities/kifu/model` の各関数 export に、対応する `describe` があるかを見る。
 *
 * ここは不変条件を担う小さな関数が並ぶ場所（`normalizeForkPointers` の境界、
 * `selectAt` の並び、`cursorKey` の正規化）。追加のたびにテストが付かないと、
 * 中身を外しても全部緑のまま通る。
 *
 * **判定に正規表現を使わない。** モジュールを実際に読み込んで `typeof` で数える。
 * ソースの書き方（既定値つきの引数、型注釈つきの `const`、関数式）に追随できず
 * 黙って拾い漏らすと、番人が消えたことに誰も気づかない。型は実行時に消え、
 * 定数は `typeof !== "function"` で落ちるので、この数え方で対象がそのまま決まる。
 *
 * 置き場がスライスの中なのは、`src/__tests__` が「レイヤに依存しない検査」の場所で
 * アプリのコードを import できないため（`vite.config.ts` の `no-restricted-imports`）。
 * 自分の居場所は `import.meta.url` から取る。
 */
const HERE = dirname(fileURLToPath(import.meta.url));

const TARGETS = [
  { name: "cursor.ts", module: cursorModule, test: "cursor.test.ts" },
  { name: "branch.ts", module: branchModule, test: "branch.test.ts" },
  { name: "jkf.ts", module: jkfModule, test: "jkf.test.ts" },
  { name: "kifu.ts", module: kifuModule, test: "kifu.test.ts" },
];

const exportedFunctions = (mod: Record<string, unknown>) =>
  Object.entries(mod)
    .filter(([, v]) => typeof v === "function")
    .map(([k]) => k)
    .sort();

// 一覧を手で写すと、model/ にファイルが増えたときこちらだけ古いまま緑になる。
// 「見ている」と言う範囲が現物とずれるのが、この検査がいちばん避けたい形。
describe("検査の範囲", () => {
  test("model/ の全ファイルを対象にしている", () => {
    const files = readdirSync(join(HERE, ".."))
      .filter((n) => n.endsWith(".ts"))
      .sort();

    expect(TARGETS.map((t) => t.name).sort()).toEqual(files);
  });
});

// 全体で0件を見て緑になる形を止める。型だけのファイル（`kifu.ts`）は関数を
// 持たないので、下限は個別でなく合計に掛ける
describe("検査の範囲", () => {
  test("関数の export を拾えている", () => {
    const total = TARGETS.reduce(
      (n, t) => n + exportedFunctions(t.module as Record<string, unknown>).length,
      0,
    );
    expect(total).toBeGreaterThan(5);
  });
});

describe.each(TARGETS)("$name の関数 export", ({ module, test: testFile }) => {
  const names = exportedFunctions(module as Record<string, unknown>);

  test("すべてに describe がある", () => {
    // 型だけのファイルはテストファイル自体を持たない
    if (names.length === 0) return;

    const body = readFileSync(join(HERE, testFile), "utf8");
    // 閉じ引用符まで見る。前方一致だと `describe("cursorKeyOld")` が `cursorKey` を満たす
    const missing = names.filter((n) => !body.includes(`describe("${n}"`));

    expect(missing).toEqual([]);
  });
});
