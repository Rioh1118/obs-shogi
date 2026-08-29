import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `ModalType` の各値に、それを読んで描くものが1つある。
 *
 * `CLAUDE.md` が「モーダルを追加したら `ModalType` を更新する」と名指ししている
 * 唯一の union。片側だけ動くと、`openModal("x")` が型検査を通って URL は変わるのに
 * 誰も描かない。`returnTo` に積まれた場合は「戻る」先が無く、URL を直に編集する
 * まで抜けられない。
 *
 * 逆向き（描くものがあるのに union に無い）は `params.modal === "x"` が
 * 型検査で落ちるので、ここでは見ない。
 */

const SRC = join(process.cwd(), "src");
const ROUTER = join(SRC, "shared", "lib", "router", "useURLParams.ts");

/** `export type ModalType =` に並ぶ文字列リテラル */
function modalTypes(): string[] {
  const source = readFileSync(ROUTER, "utf8");
  const start = source.indexOf("export type ModalType =");
  expect(start, "ModalType の定義が見つからない。検査が空振りしている").toBeGreaterThan(-1);

  const body = source.slice(start, source.indexOf(";", start));
  return [...body.matchAll(/"([\w-]+)"/g)].map((match) => match[1]);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("ModalType", () => {
  it("どの値にも、それを読んで描くものがある", () => {
    const types = modalTypes();
    expect(types.length, "ModalType の値を1つも拾えていない").toBeGreaterThan(3);

    const sources = sourceFiles(SRC)
      .filter((file) => file !== ROUTER)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    const orphans = types.filter((type) => !sources.includes(`=== "${type}"`));

    expect(
      orphans,
      [
        "ModalType にあるのに、params.modal === でそれを読む場所が無い。",
        "openModal でその値へ遷移すると、URL だけ変わって誰も描かない。",
        "描くものを足すか、値を落とすこと。",
        ...orphans,
      ].join("\n"),
    ).toEqual([]);
  });
});
