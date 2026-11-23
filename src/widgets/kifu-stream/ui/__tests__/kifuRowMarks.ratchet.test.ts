import { join } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import * as sass from "sass";
import { describe, expect, test } from "vitest";
import { SRC } from "@/__tests__/walk";

/**
 * 棋譜の一覧で選ばれて見える行は、いまの手の1つだけ。それを作っている選択子を固定する。
 *
 * フォーカスは一覧が持ち、輪はいまの手の行に描く。指した行の背景は、属性（`usePointedRow`）で描く。
 * 行に `:focus` や `:hover` を足すと、いまの手と別の行も選ばれて見える。
 *
 * 見るのは綴りでなく、コンパイルした後の選択子。属性を付け外しする側は
 * `kifuStreamFocus.test.tsx` が見る。
 */

/** `@use "@/index.scss"` を解決する。vite の alias はここには効かない */
const importer = {
  findFileUrl(url: string): URL | null {
    return url.startsWith("@/") ? pathToFileURL(join(SRC, url.slice(2))) : null;
  },
};

type Rule = { selector: string; declarations: Map<string, string> };

/** カンマで並んだ選択子は1つずつに分ける */
function rulesOf(path: string): Rule[] {
  const rules: Rule[] = [];
  const { css } = sass.compile(join(SRC, path), { importers: [importer] });

  postcss.parse(css).walkRules((rule) => {
    const declarations = new Map<string, string>();
    rule.walkDecls((decl) => void declarations.set(decl.prop, decl.value));
    for (const selector of rule.selectors) rules.push({ selector, declarations });
  });
  return rules;
}

const ROW = rulesOf("widgets/kifu-stream/ui/KifuMoveCard.scss");
const LIST = rulesOf("widgets/kifu-stream/ui/KifuStreamList.scss");

const selectorsWith = (rules: Rule[], part: string) =>
  rules.map((rule) => rule.selector).filter((selector) => selector.includes(part));

describe("輪", () => {
  test("一覧の輪は、いまの手の行に描く", () => {
    const ring = ROW.find(
      (rule) => rule.selector === ".kifu__list:focus-visible .kifu-row--active",
    );
    expect(ring?.declarations.get("outline")).toContain("2px solid");
    // 行そのものはフォーカスを持たない
    expect(selectorsWith(ROW, ".kifu-row:focus")).toEqual([]);
    expect(selectorsWith(ROW, ".kifu-row--active:focus")).toEqual([]);
  });

  test("一覧の箱そのものには描かない", () => {
    const list = LIST.find((rule) => rule.selector === ".kifu__list");

    expect(list?.declarations.get("outline")).toBe("none");
    expect(selectorsWith(LIST, ":focus")).toEqual([]);
  });
});

describe("指した行", () => {
  /** 同じ選択子が何度も出るときは、後に書かれた方が効く */
  const backgroundOf = (selector: string) =>
    ROW.filter((rule) => rule.selector === selector)
      .flatMap((rule) => rule.declarations.get("background") ?? [])
      .pop();

  test("背景は属性で描く", () => {
    expect(backgroundOf(".kifu-row[data-pointed]")).toBeDefined();
  });

  // 止まったポインタの下へ来ただけの行にも付き、いまの手と2つ選ばれて見える
  test("`:hover` で、行の背景を変えない", () => {
    const hovers = [...ROW, ...LIST].filter((rule) => rule.selector.includes(":hover"));

    expect(hovers.filter((rule) => rule.declarations.has("background"))).toEqual([]);
    // 文字の色を変えるのは、指した行のボタンだけ
    for (const { selector } of hovers) {
      expect(selector.startsWith(":where(.kifu-row[data-pointed]) ")).toBe(true);
    }
    expect(hovers.length).toBeGreaterThan(0);
  });

  test("いまの手の背景は、ポインタを載せても変わらない", () => {
    expect(backgroundOf(".kifu-row--active")).toBeDefined();
    expect(backgroundOf(".kifu-row--active[data-pointed]")).toBe(backgroundOf(".kifu-row--active"));
  });
});
