import { describe, expect, test } from "vitest";
import { stemLength } from "../path";

/** 拡張子を除いた名前の長さ。改名の欄の選択と、ツリーの名前の省き方が見る */
describe("stemLength", () => {
  test.each([
    ["角換わり.kif", 4],
    ["第1局.2026.csa", 8],
    ["メモ", 2],
    [".gitkeep", 8],
    ["", 0],
    ["末尾.", 2],
  ])("%s は %i 字", (name, length) => {
    expect(stemLength(name)).toBe(length);
  });
});
