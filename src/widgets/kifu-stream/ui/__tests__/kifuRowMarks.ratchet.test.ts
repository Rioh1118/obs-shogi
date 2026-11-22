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
    expect(selectorsWith(ROW, ":focus")).toEqual([
      ".kifu__list:focus-visible .kifu-row--active",
      ".kifu-badge--btn:focus-visible",
    ]);
  });

  test("一覧の箱そのものには描かない", () => {
    const list = LIST.find((rule) => rule.selector === ".kifu__list");

    expect(list?.declarations.get("outline")).toBe("none");
    expect(selectorsWith(LIST, ":focus")).toEqual([]);
  });
});

describe("指した行", () => {
  test("背景は属性で描き、行の `:hover` では描かない", () => {
    expect(selectorsWith(ROW, "[data-pointed]")).toEqual([
      ".kifu-row[data-pointed]",
      ".kifu-row--active[data-pointed]",
      ":where(.kifu-row[data-pointed]) .kifu-badge--btn:hover",
    ]);
  });

  test("`:hover` は、指した行のボタンだけ", () => {
    expect(selectorsWith(ROW, ":hover")).toEqual([
      ":where(.kifu-row[data-pointed]) .kifu-badge--btn:hover",
    ]);
    expect(selectorsWith(LIST, ":hover")).toEqual([]);
  });

  test("いまの手の背景は、ポインタを載せても変わらない", () => {
    const background = (selector: string) =>
      ROW.find((rule) => rule.selector === selector)?.declarations.get("background");

    expect(background(".kifu-row--active")).toBeDefined();
    expect(background(".kifu-row--active[data-pointed]")).toBe(background(".kifu-row--active"));
  });
});
