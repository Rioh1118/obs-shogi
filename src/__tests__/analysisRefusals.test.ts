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
 * 見るのは次の観点。**数を書かない**——観点を足すたびにこの行だけが古くなる。
 *
 * - **断りを拾えているか**——抽出が外れて0件になり、下が全部素通しになる、を止める
 * - **※15 に名前が出ているか**——枝が増えたのに表が追いつかない、を止める
 * - **テストがその文言を見ているか**——出ない断りを足したのに誰も踏まない、を止める
 * - **対応表を2つとも拾えているか**——抽出が外れて0件のまま緑になる、を止める
 * - **対応表の値が登録済みの断りそのものか**——表にだけ文言を直書きして、
 *   ※15 にもテストにも通らない1本が増える、を止める
 * - **対応表の値が入口の軸を名前に持つか**——▶ 用の断りが解析中の表に入る、を止める
 *   （規約の全体は `refusals.ts` の冒頭）
 *
 * どれも「その断りが**正しい**か」は見ない。踏む筋があるか、文言が現物と合うかは
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

/**
 * 対応表。**ソースから引く**——手で並べると、3つ目を足したときに書き漏らした表だけが
 * 黙って検査から外れる（`PARTS` の書き漏らしは「※15 に無い」で赤くなるので、
 * 失敗の向きが非対称になる）。
 */
const TABLE_DECLS = /export const ([A-Za-z_$][\w$]*): Record<[^>]*NotReadyReason[^>]*>/g;

const tableNames = (code: string) => [...code.matchAll(TABLE_DECLS)].map((m) => m[1]);

/** 断りではない部品。**足すならここに書く**——書かなければ表とテストを要求される */
const PARTS = new Set([
  /** 他の断りが末尾に埋め込む文 */
  "RESTART_ENGINE_HINT",
]);

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

/** 断りそのもの。**対応表は除く**（表は名前ではなく中身を下の describe が見る） */
const refusalNames = () => {
  const code = codeOf(read(REFUSALS));
  const tables = new Set(tableNames(code));
  return [...code.matchAll(NAMES)]
    .map((m) => m[1])
    .filter((name) => !PARTS.has(name) && !tables.has(name));
};

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
  // **表は「いつ出すか」で2つに割れている**——▶ を押した回と、走っている解析が
  // 切れた回。1つに減ったらどちらかの入口の断りが消えているので、番人ごと見直すこと。
  // 0件で黙る形（宣言の書き方が変わって抽出が外れる）も同じ検査で止まる。
  test("対応表を2つとも拾えている", () => {
    expect(tableNames(codeOf(read(REFUSALS))).length).toBe(2);
  });

  test.each(tableNames(codeOf(read(REFUSALS))))("%s の値は、登録済みの断りだけ", (name) => {
    const code = codeOf(read(REFUSALS));
    const table = new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`).exec(code);

    expect(table, `${REFUSALS}: \`${name}\` が見つからない`).not.toBeNull();

    // **文字列リテラルを直に置かない。** 置くと、その1本が ※15 にもテストにも
    // 通らないまま増える（対応表は断りの一覧から外れるので、こちらは素通りする）。
    expect(/:\s*["`']/.test(table![1]), `${REFUSALS}: ${name} に文言を直に書いている`).toBe(false);

    const values = [...table![1].matchAll(/:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
    expect(values.length, `${REFUSALS}: ${name} が空`).toBeGreaterThan(0);
    expect(values.filter((v) => !refusalNames().includes(v))).toEqual([]);
  });

  /**
   * **名前で入口が読めること。** 2つの表は同じ `EngineNotReadyReason` を鍵に取るので、
   * 名前が軸を持たないと「共通の断り」と読んだ人が両方へ入れる
   * （規約の全体は `refusals.ts` の冒頭）。
   */
  test.each([
    ["ON_START_REFUSALS", "_ON_START_MESSAGE"],
    ["WHILE_ANALYZING_REFUSALS", "_WHILE_ANALYZING_MESSAGE"],
  ])("%s の値は %s で終わる", (name, suffix) => {
    const code = codeOf(read(REFUSALS));
    const table = new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`).exec(code);
    const values = [...table![1].matchAll(/:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

    expect(values.filter((v) => !v.endsWith(suffix))).toEqual([]);
  });
});
