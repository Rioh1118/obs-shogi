import { describe, expect, test } from "vitest";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import { isUsableFork, isValidJKFSpecial } from "../jkf";

describe("isUsableFork", () => {
  // 変化の門。ここを通った fork は「先頭の手がある」ことを前提に扱われる
  // （branchEdit の privatizeHead が `{ ...fork[0] }` を作る）。
  test("先頭に手があれば使える", () => {
    expect(isUsableFork([{ comments: ["f"] }] as IMoveFormat[])).toBe(true);
  });

  test("undefined は使えない", () => {
    expect(isUsableFork(undefined)).toBe(false);
  });

  // 空の変化を素通しすると、指し手も special も持たない手を捏造して棋譜に書き戻す
  test("空配列は使えない", () => {
    expect(isUsableFork([])).toBe(false);
  });

  test("先頭が欠けていれば使えない", () => {
    expect(isUsableFork([null as unknown as IMoveFormat])).toBe(false);
  });
});

describe("isValidJKFSpecial", () => {
  test("JKF の special はそのまま通る", () => {
    expect(isValidJKFSpecial("TORYO")).toBe(true);
    expect(isValidJKFSpecial("CHUDAN")).toBe(true);
  });

  test("知らない文字列は通さない", () => {
    expect(isValidJKFSpecial("NOPE")).toBe(false);
    expect(isValidJKFSpecial("")).toBe(false);
  });
});
