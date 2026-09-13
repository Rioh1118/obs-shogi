import { describe, expect, test } from "vitest";
import { bookFileName, bookParentPath, readRecentBooks, rememberBook } from "../recents";

describe("最近開いた定跡", () => {
  test("新しいものが先頭に来る", () => {
    expect(rememberBook(["/a.db"], "/b.db")).toEqual(["/b.db", "/a.db"]);
  });

  test("同じパスは重ねず、先頭へ持ち上げる", () => {
    expect(rememberBook(["/a.db", "/b.db"], "/b.db")).toEqual(["/b.db", "/a.db"]);
  });

  test("溜め込まない", () => {
    const many = ["/1.db", "/2.db", "/3.db", "/4.db", "/5.db", "/6.db"];

    expect(rememberBook(many, "/new.db").length).toBeLessThanOrEqual(6);
    expect(rememberBook(many, "/new.db")[0]).toBe("/new.db");
  });

  /**
   * **設定ファイルは利用者も前の版も書く。**
   * 濾さずに画面へ渡すと、押しても何も起きない行が並ぶ。
   */
  test("文字列でないものと空文字は落とす", () => {
    expect(rememberBook([1, null, "", "/a.db"], "/b.db")).toEqual(["/b.db", "/a.db"]);
    expect(readRecentBooks([1, null, "", "/a.db"])).toEqual(["/a.db"]);
  });

  test("読み出しでも重複は畳む", () => {
    expect(readRecentBooks(["/a.db", "/a.db", "/b.db"])).toEqual(["/a.db", "/b.db"]);
  });

  test("欄そのものが無くても落ちない", () => {
    expect(readRecentBooks(null)).toEqual([]);
    expect(rememberBook(undefined, "/a.db")).toEqual(["/a.db"]);
  });
});

describe("パスの見出し", () => {
  test("区切りは OS を問わず両方見る", () => {
    expect(bookFileName("/books/user_book1.db")).toBe("user_book1.db");
    expect(bookFileName("C:\\books\\user_book1.db")).toBe("user_book1.db");
  });

  test("区切りが無ければ、そのまま名前として出す", () => {
    expect(bookFileName("user_book1.db")).toBe("user_book1.db");
    expect(bookParentPath("user_book1.db")).toBe("");
  });

  test("親は末尾の区切りまで", () => {
    expect(bookParentPath("/books/user_book1.db")).toBe("/books");
  });
});
