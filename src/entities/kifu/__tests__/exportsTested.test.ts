import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as cursorModule from "@/entities/kifu/model/cursor";
import * as branchModule from "@/entities/kifu/model/branch";
import * as jkfModule from "@/entities/kifu/model/jkf";
import * as kifuModule from "@/entities/kifu/model/kifu";
import * as advanceWithPlanModule from "@/entities/kifu/lib/advanceWithPlan";
import * as branchEditModule from "@/entities/kifu/lib/branchEdit";
import * as buildNextOptionsModule from "@/entities/kifu/lib/buildNextOptions";
import * as buildPlayerModule from "@/entities/kifu/lib/buildPlayer";
import * as cloneJkfModule from "@/entities/kifu/lib/cloneJkf";
import * as commentModule from "@/entities/kifu/lib/comment";
import * as createInitialJKFDataModule from "@/entities/kifu/lib/createInitialJKFData";
import * as eqMoveModule from "@/entities/kifu/lib/eqMove";
import * as leafTesuuModule from "@/entities/kifu/lib/leafTesuu";
import * as playerCursorModule from "@/entities/kifu/lib/playerCursor";
import * as readableMoveModule from "@/entities/kifu/lib/readableMove";
import * as resolveLineModule from "@/entities/kifu/lib/resolveLine";
import * as sanitizeJkfModule from "@/entities/kifu/lib/sanitizeJkf";
import * as applyMoveWithBranchModule from "@/entities/kifu/lib/applyMoveWithBranch";

/**
 * `entities/kifu` の `model/` と `lib/` の各関数 export に、対応する `describe` が
 * あるかを見る。
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
 * `model/` と `lib/` の両方を見るのでスライス直下に置く。
 * 自分の居場所は `import.meta.url` から取る。
 */
const HERE = dirname(fileURLToPath(import.meta.url));

type Target = { name: string; module: unknown; test: string };

const MODEL: Target[] = [
  { name: "cursor.ts", module: cursorModule, test: "cursor.test.ts" },
  { name: "branch.ts", module: branchModule, test: "branch.test.ts" },
  { name: "jkf.ts", module: jkfModule, test: "jkf.test.ts" },
  { name: "kifu.ts", module: kifuModule, test: "kifu.test.ts" },
];

const LIB: Target[] = [
  { name: "advanceWithPlan.ts", module: advanceWithPlanModule, test: "advanceWithPlan.test.ts" },
  {
    name: "applyMoveWithBranch.ts",
    module: applyMoveWithBranchModule,
    test: "applyMoveWithBranch.test.ts",
  },
  { name: "branchEdit.ts", module: branchEditModule, test: "branchEdit.test.ts" },
  { name: "buildNextOptions.ts", module: buildNextOptionsModule, test: "buildNextOptions.test.ts" },
  { name: "buildPlayer.ts", module: buildPlayerModule, test: "buildPlayer.test.ts" },
  { name: "cloneJkf.ts", module: cloneJkfModule, test: "cloneJkf.test.ts" },
  { name: "comment.ts", module: commentModule, test: "comment.test.ts" },
  {
    name: "createInitialJKFData.ts",
    module: createInitialJKFDataModule,
    test: "createInitialJKFData.test.ts",
  },
  { name: "eqMove.ts", module: eqMoveModule, test: "eqMove.test.ts" },
  { name: "leafTesuu.ts", module: leafTesuuModule, test: "leafTesuu.test.ts" },
  { name: "playerCursor.ts", module: playerCursorModule, test: "playerCursor.test.ts" },
  { name: "readableMove.ts", module: readableMoveModule, test: "readableMove.test.ts" },
  { name: "resolveLine.ts", module: resolveLineModule, test: "resolveLine.test.ts" },
  { name: "sanitizeJkf.ts", module: sanitizeJkfModule, test: "sanitizeJkf.test.ts" },
];

const TARGETS = [...MODEL, ...LIB];

const DIRS = [
  { dir: "../model", targets: MODEL },
  { dir: "../lib", targets: LIB },
];

const exportedFunctions = (mod: Record<string, unknown>) =>
  Object.entries(mod)
    .filter(([, v]) => typeof v === "function")
    .map(([k]) => k)
    .sort();

// 一覧を手で写すと、model/ にファイルが増えたときこちらだけ古いまま緑になる。
// 「見ている」と言う範囲が現物とずれるのが、この検査がいちばん避けたい形。
describe.each(DIRS)("$dir の範囲", ({ dir, targets }) => {
  test("全ファイルを対象にしている", () => {
    const files = readdirSync(join(HERE, dir))
      .filter((n) => n.endsWith(".ts"))
      .sort();

    expect(targets.map((t) => t.name).sort()).toEqual(files);
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

describe.each(TARGETS)("$name の関数 export", ({ name, module, test: testFile }) => {
  const testDir = MODEL.some((t) => t.name === name) ? "../model/__tests__" : "../lib/__tests__";
  const names = exportedFunctions(module as Record<string, unknown>);

  test("すべてに describe がある", () => {
    // 型だけのファイルはテストファイル自体を持たない
    if (names.length === 0) return;

    const body = readFileSync(join(HERE, testDir, testFile), "utf8");
    // 閉じ引用符まで見る。前方一致だと `describe("cursorKeyOld")` が `cursorKey` を満たす
    const missing = names.filter((n) => !body.includes(`describe("${n}"`));

    expect(missing).toEqual([]);
  });
});
