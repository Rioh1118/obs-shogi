import { describe, expect, test } from "vitest";

import { bookInUse } from "../types";

/** 解析にも定跡ビューにも、この1つの答えで定跡を出す */
describe("bookInUse", () => {
  test("使うと言っていて、パスがあるときだけ使う", () => {
    expect(bookInUse({ bookEnabled: true, bookFilePath: "/ai/hao/book/a.db" })).toBe(true);
  });

  /** 前の版は「解析で使わない」でもパスを残して保存している。それを使うと読まない */
  test("使わないと言っていれば、パスが残っていても使わない", () => {
    expect(bookInUse({ bookEnabled: false, bookFilePath: "/ai/hao/book/a.db" })).toBe(false);
  });

  test("使うと言っていても、パスが空なら使わない", () => {
    expect(bookInUse({ bookEnabled: true, bookFilePath: null })).toBe(false);
    expect(bookInUse({ bookEnabled: true, bookFilePath: "  " })).toBe(false);
  });
});
