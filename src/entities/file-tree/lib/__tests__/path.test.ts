import { describe, expect, test } from "vitest";
import { isSameOrDescendantPath, remapSubtreePath } from "../path";

describe("isSameOrDescendantPath", () => {
  test("同じパスと配下を真にする", () => {
    expect(isSameOrDescendantPath("/r/a", "/r/a")).toBe(true);
    expect(isSameOrDescendantPath("/r/a/b.kif", "/r/a")).toBe(true);
    expect(isSameOrDescendantPath("C:\\r\\a\\b.kif", "C:\\r\\a")).toBe(true);
  });

  // 字面の前方一致で比べると、隣のフォルダの棋譜まで巻き込んで閉じる
  test("名前の先頭が同じだけの隣は偽にする", () => {
    expect(isSameOrDescendantPath("/r/ab/c.kif", "/r/a")).toBe(false);
  });

  test("末尾の区切りの有無で結果を変えない", () => {
    expect(isSameOrDescendantPath("/r/a/", "/r/a")).toBe(true);
    expect(isSameOrDescendantPath("/r/a/b.kif", "/r/a/")).toBe(true);
  });

  test.each([null, undefined, ""])("対象が %j なら偽にする", (target) => {
    expect(isSameOrDescendantPath(target, "/r")).toBe(false);
  });
});

describe("remapSubtreePath", () => {
  test("基点そのものは新しい基点へ移す", () => {
    expect(remapSubtreePath("/r/a", "/r/a", "/r/b")).toBe("/r/b");
  });

  test("配下は基点を付け替える", () => {
    expect(remapSubtreePath("/r/a/c/d.kif", "/r/a", "/r/b")).toBe("/r/b/c/d.kif");
    expect(remapSubtreePath("C:\\r\\a\\d.kif", "C:\\r\\a", "C:\\r\\b")).toBe("C:\\r\\b\\d.kif");
  });

  test("末尾の区切りを落として比べる", () => {
    expect(remapSubtreePath("/r/a/", "/r/a/", "/r/b/")).toBe("/r/b");
  });

  test("配下でないものは null を返す", () => {
    expect(remapSubtreePath("/r/ab", "/r/a", "/r/b")).toBeNull();
  });

  test.each([null, undefined, ""])("対象が %j なら null を返す", (target) => {
    expect(remapSubtreePath(target, "/r/a", "/r/b")).toBeNull();
  });
});
