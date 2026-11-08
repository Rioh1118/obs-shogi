import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { LITERAL_ONLY_TERMS, METAPHOR } from "./metaphorTerms";
import { REPO_ROOT } from "./walk";

/**
 * デザインシステムの現役の文書に、置き換えた比喩の語を書かない。
 *
 * コメントの検査（`commentReadability.test.ts`）は Markdown とトークンの説明を見ない。
 * デザインシステムは画面の語の正本なので、ここに比喩が入ると製品のコメントへ写っていく。
 * UI の土台は「サーフェス」と書く。
 *
 * 見ないもの: `DESIGN.md`（生成物）、`explorations/` と `decisions/`（書いた時点の記録）。
 */
const DS = join(REPO_ROOT, "design-system");

function files(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return [
    ...walk(join(DS, "design_system")).filter(
      (f) => /\.(md|json)$/.test(f) && !f.endsWith("DESIGN.md"),
    ),
    join(DS, "SKILL.md"),
  ];
}

describe("デザインシステムの文書の語", () => {
  it("比喩の語と、比喩の「面」を書かない", () => {
    const found = files().flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          METAPHOR.test(line) || LITERAL_ONLY_TERMS.面.test(line)
            ? [`${relative(REPO_ROOT, file)}:${i + 1} ${line.trim().slice(0, 80)}`]
            : [],
        ),
    );

    expect(found, "指している実物の語で書く（UI の土台はサーフェス）").toEqual([]);
  });
});
