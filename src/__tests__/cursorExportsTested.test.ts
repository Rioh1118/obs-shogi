import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * `entities/kifu/model/cursor.ts` の各 export に、対応する `describe` があるかを見る。
 *
 * このファイルはカーソルと分岐計画の語彙の置き場で、`normalizeForkPointers` /
 * `selectAt` / `cursorKey` のような**不変条件を担う小さな関数**が並ぶ。
 * 追加のたびにテストが付かないと、正規化や境界を外しても全部緑のまま通る
 * （実際に `cursorKey` / `makeKifuCursor` / `descendTo` で3回起きた）。
 *
 * 型と定数は対象外。振る舞いを持たないので `describe` を強制しても中身が書けない。
 */
const SOURCE = join(REPO_ROOT, "src/entities/kifu/model/cursor.ts");
const TEST = join(REPO_ROOT, "src/entities/kifu/model/__tests__/cursor.test.ts");

/** `export function foo` と `export const foo = (…) =>` を拾う。型・非関数の定数は拾わない */
function exportedFunctions(source: string): string[] {
  const names = new Set<string>();

  for (const [, name] of source.matchAll(/^export function ([A-Za-z0-9_]+)/gm)) {
    names.add(name);
  }
  for (const [, name] of source.matchAll(/^export const ([A-Za-z0-9_]+)\s*=\s*[^=]*=>/gm)) {
    names.add(name);
  }

  return [...names].sort();
}

describe("model/cursor.ts の export", () => {
  const source = readFileSync(SOURCE, "utf8");
  const names = exportedFunctions(source);

  // 0件を見て緑になる形を止める。正規表現が実装の書き方に追随できなくなったら落とす
  test("関数の export を拾えている", () => {
    expect(names.length).toBeGreaterThan(5);
  });

  test("すべてに describe がある", () => {
    const body = readFileSync(TEST, "utf8");
    const missing = names.filter((n) => !body.includes(`describe("${n}`));

    expect(missing).toEqual([]);
  });
});

describe("exportedFunctions", () => {
  test("export function を拾う", () => {
    expect(exportedFunctions("export function selectAt(a: number) {}")).toEqual(["selectAt"]);
  });

  test("アロー関数の export も拾う", () => {
    expect(exportedFunctions("export const asBranchPlan = (fps: F[]) => fps as B;")).toEqual([
      "asBranchPlan",
    ]);
  });

  test("型は拾わない", () => {
    expect(exportedFunctions("export type CursorPath = { tesuu: number };")).toEqual([]);
  });

  // 振る舞いを持たない定数に describe を求めても中身が書けない
  test("関数でない定数は拾わない", () => {
    expect(exportedFunctions("export const ROOT_CURSOR = { tesuu: 0 };")).toEqual([]);
  });

  test("export していない関数は拾わない", () => {
    expect(exportedFunctions("function buildTesuuPointer(a: number) {}")).toEqual([]);
  });
});
