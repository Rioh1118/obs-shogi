import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { hitsIn } from "./sourceText";

/**
 * 「この綴りを書いてよいのはこのファイルだけ」を見る検査の本体。
 *
 * 走査の対象を `walk.ts` が、読んだ中身の均し方を `sourceText.ts` が1箇所で決めているのと
 * 同じ理由でここに置く。**検査ごとに書き下ろすと、片方だけが危ない形のまま残る**
 * ——owners の判定に穴が見つかったとき、直るのが片方だけになる。
 *
 * テストは走査から外す（`includeTests: false`）。テストが自分で材料を作るのは、
 * 現物の役をテストが演じているぶんなので止めない。
 */
export type OwnedSpelling = {
  /** 検査の名前。`describe` に出る */
  readonly name: string;
  /** 持ち主の外で書いてはいけない綴り */
  readonly pattern: RegExp;
  /** 書いてよいファイル（リポジトリからの相対パス） */
  readonly owners: readonly string[];
};

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

export function describeOwnedSpellings(rules: readonly OwnedSpelling[]) {
  describe.each(rules)("$name", ({ pattern, owners: ownerTuple }) => {
    // リテラル型の tuple のままだと includes / each の引数が never に狭まる
    const owners: string[] = [...ownerTuple];

    test("持ち主の外では書いていない", () => {
      const offenders = tsFiles(SRC, { includeTests: false })
        .map((path) => relative(REPO_ROOT, path))
        .filter((rel) => !owners.includes(rel))
        .flatMap((rel) => hitsIn(rel, read(rel), pattern))
        .sort();

      expect(offenders).toEqual([]);
    });

    // 対象が0件になって「何も見ていないのに緑」になる形を止める
    test.each(owners)("%s では実際に書いている", (rel) => {
      expect(
        hitsIn(rel, read(rel), pattern).length > 0,
        `${rel} からこの綴りが消えたなら、owners から外して番人を減らすこと`,
      ).toBe(true);
    });
  });
}
