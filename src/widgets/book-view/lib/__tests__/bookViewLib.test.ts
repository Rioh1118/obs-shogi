import { describe, expect, test } from "vitest";
import { bookMoveTexts } from "../moveTexts";
import { bookOpenTargets } from "../openTargets";

const INITIAL_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const move = (usiMove: string, ponder: string | null) => ({
  usiMove,
  ponder,
  value: null,
  depth: null,
  count: null,
});

/**
 * 候補手と応手の綴り。読めない欄が1つあっても、読める欄まで USI に戻さないこと。
 *
 * 戻すと、壊れた応手を持つ定跡では候補手まで日本語で読めなくなる。
 */
describe("bookMoveTexts", () => {
  test("候補手と応手を両方日本語にする", () => {
    expect(bookMoveTexts(INITIAL_SFEN, move("7g7f", "3c3d"))).toEqual({
      move: "☗７六歩",
      ponder: "☖３四歩",
    });
  });

  test("応手が局面に当たらなくても、候補手は日本語にして応手は綴りのまま出す", () => {
    expect(bookMoveTexts(INITIAL_SFEN, move("7g7f", "5e5d"))).toEqual({
      move: "☗７六歩",
      ponder: "5e5d",
    });
  });

  test("応手が無ければ — を出す", () => {
    expect(bookMoveTexts(INITIAL_SFEN, move("7g7f", null))).toEqual({
      move: "☗７六歩",
      ponder: "—",
    });
  });

  test("候補手が局面に当たらなければ、候補手も綴りのまま出す", () => {
    expect(bookMoveTexts(INITIAL_SFEN, move("5e5d", null)).move).toBe("5e5d");
  });

  test("局面が無ければ綴りのまま出す", () => {
    expect(bookMoveTexts(null, move("7g7f", "3c3d"))).toEqual({
      move: "7g7f",
      ponder: "3c3d",
    });
  });
});

/**
 * 空の画面の一覧。同じ定跡を2つ並べない。
 */
describe("bookOpenTargets", () => {
  const base = {
    presetBookPath: null,
    presetName: null,
    recents: [] as string[],
  };

  test("プリセットの定跡にはプリセットの名前を添える", () => {
    const { fromPreset } = bookOpenTargets({
      ...base,
      presetBookPath: "/ai/hao/book/user_book1.db",
      presetName: "研究",
    });

    expect(fromPreset).toEqual([
      { path: "/ai/hao/book/user_book1.db", name: "user_book1.db", note: "研究 の定跡" },
    ]);
  });

  test("プリセットの名前が無ければ、選んでいるプリセットの定跡と添える", () => {
    const { fromPreset } = bookOpenTargets({ ...base, presetBookPath: "/b/a.db" });

    expect(fromPreset[0].note).toBe("選んでいるプリセットの定跡");
  });

  test("最近開いた定跡には置き場を添える", () => {
    const { recent } = bookOpenTargets({ ...base, recents: ["/books/x.db", "/old/y.db"] });

    expect(recent).toEqual([
      { path: "/books/x.db", name: "x.db", note: "/books" },
      { path: "/old/y.db", name: "y.db", note: "/old" },
    ]);
  });

  test("プリセットの定跡と同じものは、最近開いた側から外す", () => {
    const { fromPreset, recent } = bookOpenTargets({
      ...base,
      presetBookPath: "/books/x.db",
      recents: ["/books/x.db", "/old/y.db"],
    });

    expect(fromPreset.map((t) => t.path)).toEqual(["/books/x.db"]);
    expect(recent.map((t) => t.path)).toEqual(["/old/y.db"]);
  });
});
