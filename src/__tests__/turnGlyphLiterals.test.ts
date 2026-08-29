import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 先後の記号（☗ / ☖）の直書きを禁じる
 *
 * どちらがどちらの手番かは字面から読み取れず、直書きが散るほど取り違える。
 * oxlint に `no-restricted-syntax` が無いので、ここで文字列として拾う。
 */

const SRC = join(process.cwd(), "src");

/** 定義元。ここだけが記号のリテラルを持ってよい。 */
const DEFINITION = join("shared", "lib", "turn.ts");

/** テストは期待値として記号を書くので対象外。 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** コメント中の例は対象外。禁じたいのは画面に出るリテラル。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("先後の記号の直書き", () => {
  it("shared/lib/turn.ts 以外に無い", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file))
      .filter((file) => file !== DEFINITION)
      .filter((file) => /[☗☖]/.test(stripComments(readFileSync(join(SRC, file), "utf8"))));

    expect(
      offenders,
      ["先後の記号は @/shared/lib/turn の定数を使うこと。", ...offenders].join("\n"),
    ).toEqual([]);
  });
});
