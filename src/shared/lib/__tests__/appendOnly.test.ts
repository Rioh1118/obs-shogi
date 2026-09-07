import { describe, expect, test } from "vitest";

import { isAppendOnlyContinuation } from "../appendOnly";

/**
 * 増分の導出はどれもこの述語に乗る（一覧の平坦化・並べ替え）。**間違えると
 * 古い並びを黙って返し続ける**ので、境目をここで固定する。
 */

const a = { v: "a" };
const b = { v: "b" };
const c = { v: "c" };

describe("isAppendOnlyContinuation", () => {
  test("まだ何も見ていなければ、いつでも続きから足せる", () => {
    expect(isAppendOnlyContinuation([a, b], 0, null)).toBe(true);
    expect(isAppendOnlyContinuation([], 0, null)).toBe(true);
  });

  test("見たところまでが先頭と一致していれば足せる", () => {
    expect(isAppendOnlyContinuation([a, b, c], 2, b)).toBe(true);
  });

  test("同じ長さのまま止まっていても足せる（新着ぶんが0件）", () => {
    expect(isAppendOnlyContinuation([a, b], 2, b)).toBe(true);
  });

  /** 検索し直すと、同じ長さでも実体は別。前の続きに足してはいけない */
  test("実体が入れ替わったら足せない", () => {
    expect(isAppendOnlyContinuation([a, { v: "b" }, c], 2, b)).toBe(false);
  });

  test("縮んだら足せない", () => {
    expect(isAppendOnlyContinuation([a], 2, b)).toBe(false);
  });

  /**
   * **末尾の1つしか見ない。** 中間が差し替わる並びには使えない、と doc が
   * 断っている境目。ここが真を返すことを固定しておかないと、次に読む人が
   * 「全件を見ている」と誤解する
   */
  test("中間だけが差し替わったのは見抜けない（見ているのは末尾の1つだけ）", () => {
    expect(isAppendOnlyContinuation([{ v: "a" }, b, c], 2, b)).toBe(true);
  });
});
