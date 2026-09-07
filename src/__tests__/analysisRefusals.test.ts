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
 * **`RESTART_ENGINE_HINT` は断りではない**（他の断りが埋め込む部品）ので数から外す。
 */
const REFUSALS = "src/entities/analysis/model/refusals.ts";
const NOTES = "docs/state-transitions/analysis.md";
const TESTS = "src/entities/analysis/model/__tests__/provider.test.tsx";

/** 断りの定数。`RESTART_ENGINE_HINT` は部品なので数えない */
const NAMES = /export const ([A-Z][A-Z0-9_]*_MESSAGE)\b/g;

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

const refusalNames = () => [...codeOf(read(REFUSALS)).matchAll(NAMES)].map((m) => m[1]);

describe("解析の断り", () => {
  // 対象が0件になって「何も見ていないのに緑」になる形を止める
  test("断りを拾えている", () => {
    expect(refusalNames().length).toBeGreaterThan(3);
  });

  test.each(refusalNames())("%s が ※15 に載っている", (name) => {
    expect(
      read(NOTES).includes(name),
      `${NOTES} の ※15 に \`${name}\` の枝が無い。断りを1本足したら、表にも枝を足すこと`,
    ).toBe(true);
  });

  test.each(refusalNames())("%s を踏むテストがある", (name) => {
    expect(
      read(TESTS).includes(name),
      `${TESTS} が \`${name}\` を見ていない。踏む筋が無い断りなら、定数ごと落とすこと`,
    ).toBe(true);
  });
});
