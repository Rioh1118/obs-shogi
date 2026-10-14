import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, scssFiles, tsFiles } from "./walk";

/**
 * SCSS が定義している BEM の要素（`block__element`）のうち、`src/` のどのコードにも綴りが無いもの。
 * **増やさない。**
 *
 * 部品を消すと、その部品だけが使っていた規則が SCSS に残る。tsc も lint も見ないので緑のまま通り、
 * 次に見た目を直す人は、効いていない規則を直して「直したのに効かない」を踏む（同じ規則が2つの
 * SCSS に重なっていると、どちらが勝つかは読み込み順で決まる）。
 *
 * 見るのは**要素だけ**（`--` の修飾を含むものは見ない）。修飾は `uiBtn--${tone}` のように
 * 綴りを組んで付けるので、綴りが無いことが使っていないことを意味しない。
 *
 * 減らしたら `BASELINE` を下げること。下げないと、次に増えたぶんが隠れる。
 */
const BASELINE = 29;

/** `.block {` と、その中の `&__element {` を、展開した綴りで集める */
function definedElements(scss: string): string[] {
  const found: string[] = [];
  // 開いている `{` ごとの「いまの block」。セレクタでない `{`（`@media` など）は親を引き継ぐ
  const stack: (string | null)[] = [];
  const top = (): string | null => (stack.length > 0 ? stack[stack.length - 1] : null);
  for (const raw of scss.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "");
    const rule = /^\s*([^{}]+?)\s*\{\s*$/.exec(line);
    if (rule) {
      const parent = top();
      const block = /^\.([A-Za-z][\w-]*)$/.exec(rule[1]);
      const nested = /^&(__\w+)$/.exec(rule[1]);
      const name = block ? block[1] : nested && parent ? parent + nested[1] : null;
      if (name?.includes("__") && !name.includes("--")) found.push(name);
      stack.push(name ?? parent);
    } else {
      for (const _ of line.matchAll(/\{/g)) stack.push(top());
    }
    for (const _ of line.matchAll(/\}/g)) stack.pop();
  }
  return found;
}

describe("SCSS の BEM の要素", () => {
  const code = tsFiles(SRC, { includeTests: false })
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const defined = scssFiles(SRC).flatMap((p) =>
    definedElements(readFileSync(p, "utf8")).map((name) => ({
      file: relative(REPO_ROOT, p),
      name,
    })),
  );
  const unused = defined.filter(
    ({ name }) => !new RegExp(`\\b${name.replace(/[-]/g, "\\-")}\\b`).test(code),
  );

  /** 走査が壊れて何も拾わなくなったら、未使用も0になって緑のまま通る */
  it("走査が要素を拾えている", () => {
    expect(defined.length).toBeGreaterThan(500);
  });

  it("どのコードにも綴りが無い要素が増えていない", () => {
    expect(
      unused.length,
      [
        `綴りの無い要素が ${BASELINE} 件から ${unused.length} 件になった。`,
        "部品を消したなら、その部品だけが使っていた規則も消すこと。減らしたなら BASELINE を下げること。",
        ...unused.map(({ file, name }) => `  ${file}: ${name}`),
      ].join("\n"),
    ).toBe(BASELINE);
  });
});
