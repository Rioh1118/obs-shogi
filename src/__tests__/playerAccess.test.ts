import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * `JKFPlayer` を組む・動かす・観測する呼び出しを `entities/kifu/lib` に閉じる。
 *
 * `goto` に渡す手前の正規化、`getTesuuPointer` の観測値の作り方、棋譜を複製するかの
 * 判断は、どれも1箇所で決まっていないと食い違う。実際この3つは同じ規則が
 * 呼び出し側に手書きで写る形で散り、寄せ直すのに何度も掛かった。
 *
 * ラチェット。**減らすのはよいが増やさない。** 許可しているのは
 * `PreviewData.nodeId` を組む2箇所で、そのフィールドには読み手が居ない（→ #302）。
 * `nodeId` を落とせばこの許可も消える。
 */
const GUARDED = /new JKFPlayer\(|\.goto\(|\.getTesuuPointer\(|\.getForkPointers\(/;

/**
 * コメントを落としてから探す。doc は `JKFPlayer.getTesuuPointer()` のように
 * メソッドを名指しするので、そのままだと説明している側が違反に数えられる。
 */
const codeOf = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** 口を持つ側。ここは呼んでよい */
const OWNER = "src/entities/kifu/lib/";

/** 既知の違反。増やさないための基準線であって、正しさの宣言ではない */
const ALLOWED = [
  "src/features/position-navigation/ui/PositionNavigationModal.tsx",
  "src/features/position-search/ui/PositionSearchModal.tsx",
];

describe("JKFPlayer に触る場所", () => {
  // 読むのは絶対パス。相対にすると `process.cwd()` から解決され、`walk.ts` が
  // 起点を `import.meta.url` で固定した意味が消える（このリポジトリは
  // `.claude/worktrees/` に複数の作業ツリーを持つので、別の木を読みうる）。
  const offenders = tsFiles(SRC, { includeTests: false })
    .map((path) => ({ path, rel: relative(REPO_ROOT, path) }))
    .filter(({ rel }) => !rel.startsWith(OWNER))
    .filter(({ path }) => GUARDED.test(codeOf(readFileSync(path, "utf8"))))
    .map(({ rel }) => rel)
    .sort();

  // 0件を見て緑になる形を止める（正規表現が実装に追随できなくなったら落ちる）
  test("口を持つ側では実際に呼んでいる", () => {
    const owners = tsFiles(SRC, { includeTests: false })
      .filter((path) => relative(REPO_ROOT, path).startsWith(OWNER))
      .filter((path) => GUARDED.test(codeOf(readFileSync(path, "utf8"))));

    expect(owners.length).toBeGreaterThan(0);
  });

  test("entities/kifu/lib の外から呼んでいない", () => {
    expect(offenders).toEqual(ALLOWED);
  });
});
