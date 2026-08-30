import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * `KifuCursor` の材料を鋳造する綴りを、それを持つファイルの中に閉じる。
 *
 * 型を組む側は `KifuCursor` の brand が止める（`model/cursor.ts` 参照）。
 * ここが見るのは brand をすり抜ける綴り、つまり**キャスト**と、
 * 観測値を受け取らずに `KifuCursor` を組める `makeKifuCursor` の呼び出し。
 *
 * 要求の鍵が `state.cursor.tesuuPointer`（観測の欄）に入ると、
 * `provider.tsx` の移動前後の比較が着けもしない局面の識別子で回り、
 * **盤が動かないのにエラーも出ない**。doc に書いても型でも止まらない種類の規約なので、
 * 綴りをここで止める。
 *
 * 山括弧キャスト（`<TesuuPointer>s`）は `erasableSyntaxOnly` が TS1294 で
 * 落とすので、ここでは見ない。
 *
 * **止められていない形が1つある。** `{ ...cursor, tesuu: cursor.tesuu + 1 }` のように
 * `tesuuPointer` を書かずにスプレッドだけで別の局面のカーソルを作ると、
 * 手数と識別子が食い違ったまま通る。綴りで見分けるには
 * 「カーソルのスプレッド」を名前で拾うしかなく、`previewCursor`（`CursorPath` なので
 * 無害）が現に引っ掛かる。名前に頼る規則を足すより、`cursorFromPlayer` を
 * 通していない `KifuCursor` は作らない、という規約で持たせている。
 */
const RULES = [
  {
    /**
     * 呼び出しだけを見ると `import { makeKifuCursor as mk }` で名前を変えられ、
     * 別名の `mk(...)` が素通りする。持ち出しの段階で止める。
     */
    name: "makeKifuCursor の綴り",
    pattern: /\bmakeKifuCursor\b/,
    owners: ["src/entities/kifu/model/cursor.ts", "src/entities/kifu/lib/playerCursor.ts"],
  },
  {
    name: "makeKifuCursor の呼び出し",
    /** 宣言行 `export function makeKifuCursor(` は呼び出しではないので数から外す */
    pattern: /(?<!function\s)\bmakeKifuCursor\s*\(/,
    /** 宣言は `model/cursor.ts` にあるが、**呼ぶ**のは `playerCursor.ts` だけ */
    owners: ["src/entities/kifu/lib/playerCursor.ts"],
  },
  {
    name: "TesuuPointer への as キャスト",
    pattern: /as TesuuPointer/,
    owners: ["src/entities/kifu/model/cursor.ts"],
  },
  {
    /**
     * `{ ...cursor, tesuuPointer: ... }` と `{ ...cursor, tesuu: ... }`。
     * スプレッドは brand ごと写すので型では止まらない。**欄に書く側**を見る。
     * 読み取り（`.tesuuPointer`）は `:` を伴わないので当たらない。
     */
    name: "tesuuPointer への書き込み",
    pattern: /tesuuPointer\s*:/,
    owners: ["src/entities/kifu/model/cursor.ts"],
  },
  {
    /** 二重キャストは brand を素通りする。`PlannedCursor` も同じ守り方に揃える */
    name: "カーソル型への as キャスト",
    pattern: /as (?:unknown as )?(?:KifuCursor|PlannedCursor)\b/,
    owners: ["src/entities/kifu/model/cursor.ts"],
  },
] as const;

const read = (rel: string) => codeOf(readFileSync(join(REPO_ROOT, rel), "utf8"));

describe.each(RULES)("$name", ({ pattern, owners: ownerTuple }) => {
  // リテラル型の tuple のままだと includes / each の引数が never に狭まる
  const owners: string[] = [...ownerTuple];

  test("持ち主の外では書いていない", () => {
    const offenders = tsFiles(SRC, { includeTests: false })
      .map((path) => relative(REPO_ROOT, path))
      .filter((rel) => !owners.includes(rel))
      .filter((rel) => pattern.test(read(rel)))
      .sort();

    expect(offenders).toEqual([]);
  });

  // 対象が0件になって「何も見ていないのに緑」になる形を止める
  test.each(owners)("%s では実際に書いている", (rel) => {
    expect(
      pattern.test(read(rel)),
      `${rel} からこの綴りが消えたなら、owners から外して番人を減らすこと`,
    ).toBe(true);
  });
});
