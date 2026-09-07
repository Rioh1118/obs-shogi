import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";
import { codeOf } from "./sourceText";

/**
 * 解析の断り（`model/refusals.ts`）を、**表とテストの両方に繋ぐ**。
 *
 * 断りを1本足したときに `docs/state-transitions/analysis.md` の ※15 へ通し忘れる形は、
 * 人の目では止まらない——doc が散文の言い換えで枝を指していると、突き合わせる鍵が無い。
 * **定数名を鍵にする。**
 *
 * 見るのは2つ。
 *
 * - **※15 に名前が出ているか**——枝が増えたのに表が5枝のまま、を止める
 * - **テストがその文言を見ているか**——出ない断りを足したのに誰も踏まない、を止める
 *
 * どちらも「その断りが**正しい**か」は見ない。踏む筋があるか、文言が現物と合うかは
 * `provider.test.tsx` の側の仕事。
 *
 * **対象は `refusals.ts` の `export const` 全部。** 名前の末尾では選ばない——
 * `..._NOTICE` と名付けた1本が黙って義務から外れる。断りでない部品（他の断りが
 * 埋め込む文）だけを、下の `PARTS` に**名前で書いて**外す。
 */
const REFUSALS = "src/entities/analysis/model/refusals.ts";
const NOTES = "docs/state-transitions/analysis.md";
const TESTS = "src/entities/analysis/model/__tests__/provider.test.tsx";

const NAMES = /export const ([A-Z][A-Z0-9_]*)\b/g;

/** 断りではない部品。**足すならここに書く**——書かなければ表とテストを要求される */
const PARTS = new Set(["RESTART_ENGINE_HINT"]);

/**
 * ※15 の節だけを切り出す。他の注や表のセルに名前が1度出ただけで通るのを止める。
 *
 * **行頭の `※15` を探す**——イベントの表のセルにも `※15` の参照が出るので、
 * 素朴な `indexOf` はそちらに当たる。
 */
const noteFifteen = (body: string) => {
  const start = body.search(/^※15 /m);
  if (start === -1) return "";
  const rest = body.slice(start + 4);
  const end = rest.search(/^## |^※/m);
  return end === -1 ? rest : rest.slice(0, end);
};

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

/** `import { ... } from "../refusals";` の中身を落とす */
const withoutImports = (body: string) => body.replace(/import \{[\s\S]*?\} from "[^"]*";/g, "");

const refusalNames = () =>
  [...codeOf(read(REFUSALS)).matchAll(NAMES)].map((m) => m[1]).filter((name) => !PARTS.has(name));

describe("解析の断り", () => {
  // 対象が0件になって「何も見ていないのに緑」になる形を止める
  test("断りを拾えている", () => {
    expect(refusalNames().length).toBeGreaterThan(3);
  });

  test.each(refusalNames())("%s が ※15 に載っている", (name) => {
    expect(
      noteFifteen(read(NOTES)).includes(name),
      `${NOTES} の ※15 に \`${name}\` の枝が無い。断りを1本足したら、表にも枝を足すこと`,
    ).toBe(true);
  });

  test.each(refusalNames())("%s を踏むテストがある", (name) => {
    // **import しただけでは通さない。** 断りを読み込む行を落としてから探す。
    expect(
      withoutImports(read(TESTS)).includes(name),
      `${TESTS} が \`${name}\` を使っていない。踏む筋が無い断りなら、定数ごと落とすこと`,
    ).toBe(true);
  });
});
