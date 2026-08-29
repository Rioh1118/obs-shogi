import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Color } from "shogi.js";
import { GOTE_GLYPH, GOTE_LABEL, SENTE_GLYPH, SENTE_LABEL, turnGlyph, turnLabel } from "../turn";

describe("turnGlyph / turnLabel", () => {
  test("先手は ☗、後手は ☖", () => {
    expect(turnGlyph(Color.Black)).toBe("☗");
    expect(turnGlyph(Color.White)).toBe("☖");
  });

  test("記号と語がずれない", () => {
    expect(turnLabel(Color.Black)).toBe("☗先手");
    expect(turnLabel(Color.White)).toBe("☖後手");
    expect(SENTE_LABEL.startsWith(SENTE_GLYPH)).toBe(true);
    expect(GOTE_LABEL.startsWith(GOTE_GLYPH)).toBe(true);
  });
});

const SRC = join(process.cwd(), "src");

/** 定義元。ここだけが記号のリテラルを持ってよい。 */
const DEFINITION = join(SRC, "shared", "lib", "turn.ts");

/** テストは期待値として記号を書くので対象外。 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

/** コメント中の例は対象外。禁じたいのは画面に出るリテラル。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("先後の記号の直書き", () => {
  // oxlint に no-restricted-syntax が無いため、機械的な担保をここに置く。
  // どちらの記号がどちらの手番かは字面から読めず、直書きすると取り違える。
  test("shared/lib/turn.ts 以外にリテラルが無い", () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => f !== DEFINITION)
      .filter((f) => /[☗☖]/.test(stripComments(readFileSync(f, "utf-8"))))
      .map((f) => relative(process.cwd(), f));

    expect(offenders).toEqual([]);
  });
});
