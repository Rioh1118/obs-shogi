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
 * **対象は `refusals.ts` の `export const` 全部**（名前の形も問わない）。末尾や大文字で
 * 選ぶと、そこから外れた名前の1本が黙って義務から外れる。断りでない部品だけを、
 * 下の `PARTS` に**名前で書いて**外す——`PARTS` に足すのは「断りではない」と言い切れる
 * ときだけで、それが唯一の逃げ道。
 */
const REFUSALS = "src/entities/analysis/model/refusals.ts";
const NOTES = "docs/state-transitions/analysis.md";
const TESTS = "src/entities/analysis/model/__tests__/provider.test.tsx";

const NAMES = /export const ([A-Za-z_$][\w$]*)\b/g;

/** 断りではない部品。**足すならここに書く**——書かなければ表とテストを要求される */
const PARTS = new Set([
  /** 他の断りが末尾に埋め込む文 */
  "RESTART_ENGINE_HINT",
  /** 断りそのものではなく、`EngineNotReadyReason` から断りへの対応表 */
  "NOT_READY_REFUSALS",
  /** 同じく対応表。**`null` は「断らない」**を意味する枝を持つ */
  "WHILE_ANALYZING_REFUSALS",
]);

/**
 * `EngineNotReadyReason` を鍵に取る対応表。**どれも同じ2つを守らせる**——
 * 文言を直に置かないことと、値が登録済みの断りであること。
 *
 * **`PARTS` に入れた表をここに書き漏らすと、その表だけ検査から外れる。**
 * `PARTS` は「※15 とテストの義務を免除する」ためのもので、
 * 中身を見ない理由にはならない。
 */
const TABLES = [
  { name: "NOT_READY_REFUSALS", allowsNull: false },
  /** `starting` は待てば戻るので断らない → `null` */
  { name: "WHILE_ANALYZING_REFUSALS", allowsNull: true },
];

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

/**
 * `import { ... } from "../refusals";` の中身を落とす。
 * **コメントは `codeOf` が落とす**——「まだ踏めない」と1行書けば通る形を残さない。
 */
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
      withoutImports(codeOf(read(TESTS))).includes(name),
      `${TESTS} が \`${name}\` を使っていない。踏む筋が無い断りなら、定数ごと落とすこと`,
    ).toBe(true);
  });
});

describe("エンジンが使えない理由への対応", () => {
  test.each(TABLES)("$name の値は、登録済みの断りだけ", ({ name, allowsNull }) => {
    const code = codeOf(read(REFUSALS));
    const table = new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`).exec(code);

    expect(table, `${REFUSALS}: \`${name}\` が見つからない`).not.toBeNull();

    // **文字列リテラルを直に置かない。** 置くと、その1本が ※15 にもテストにも
    // 通らないまま増える（対応表は `PARTS` に入っているので、こちらは素通りする）。
    expect(/:\s*["`']/.test(table![1]), `${REFUSALS}: ${name} に文言を直に書いている`).toBe(false);

    const values = [...table![1].matchAll(/:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(values.length, `${REFUSALS}: ${name} が空`).toBeGreaterThan(0);

    // **`null` を許す表でも、綴りは1つだけ。** `undefined` や `""` を混ぜると
    // 「断らない」の書き方が増え、読む側が全部を覚えることになる。
    const known = allowsNull ? [...refusalNames(), "null"] : refusalNames();
    expect(values.filter((v) => !known.includes(v))).toEqual([]);
  });

  // **`null` の枝を持つ表は、全部が `null` になっていないか見る。**
  // 全部 `null` なら断る経路が1本も無く、表があるのに何も起きない。
  test("WHILE_ANALYZING_REFUSALS は少なくとも1本は断る", () => {
    const code = codeOf(read(REFUSALS));
    const table = /WHILE_ANALYZING_REFUSALS[^=]*=\s*\{([\s\S]*?)\};/.exec(code);
    const values = [...table![1].matchAll(/:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

    expect(values.filter((v) => v !== "null").length).toBeGreaterThan(0);
  });
});
