import { describe, expect, test } from "vitest";
import {
  bookFileName,
  bookParentPath,
  MAX_RECENT_BOOKS,
  readRecentBooks,
  rememberBook,
} from "../recents";

describe("最近開いた定跡", () => {
  test("新しいものが先頭に来る", () => {
    expect(rememberBook(["/a.db"], "/b.db")).toEqual(["/b.db", "/a.db"]);
  });

  test("同じパスは重ねず、先頭へ持ち上げる", () => {
    expect(rememberBook(["/a.db", "/b.db"], "/b.db")).toEqual(["/b.db", "/a.db"]);
  });

  /** **上限を綴りで固定する。** `slice(0, 6)` への変異で緑にならないこと */
  test("溜め込まない", () => {
    const many = ["/1.db", "/2.db", "/3.db", "/4.db", "/5.db", "/6.db"];

    expect(rememberBook(many, "/new.db")).toHaveLength(MAX_RECENT_BOOKS);
    expect(rememberBook(many, "/new.db")[0]).toBe("/new.db");
  });

  /**
   * **上限は読む側にも掛かる。**
   *
   * 上限の理由は「空の画面に並ぶ数」なので、書く側にしか掛けないと、
   * 前の版や手で書かれた一覧がそのままボタンの数になる。
   */
  test("読み出すときも上限で切る", () => {
    const many = ["/1.db", "/2.db", "/3.db", "/4.db", "/5.db", "/6.db", "/7.db"];

    expect(readRecentBooks(many)).toHaveLength(MAX_RECENT_BOOKS);
  });

  /** 押しても何も起きない行を並べない */
  test("空の綴りと、名前の取れない綴りは落とす", () => {
    expect(rememberBook(["", "/a.db"], "/b.db")).toEqual(["/b.db", "/a.db"]);
    // 区切りで終わる綴りは `bookFileName` が空を返す＝名前の無いボタンになる
    expect(readRecentBooks(["", "/books/", "/a.db"])).toEqual(["/a.db"]);
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
