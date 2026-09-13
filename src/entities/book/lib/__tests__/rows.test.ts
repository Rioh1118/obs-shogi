import { describe, expect, test } from "vitest";
import type { BookLine, BookMove } from "@/entities/book/model/types";
import {
  attachLines,
  countBarRatio,
  DEFAULT_BOOK_SORT,
  maxCount,
  nextBookSort,
  sortBookRows,
  type BookRow,
} from "../rows";

const move = (usi: string, fields: Partial<BookMove> = {}): BookMove => ({
  usiMove: usi,
  ponder: null,
  value: null,
  depth: null,
  count: null,
  ...fields,
});

const row = (usi: string, fields: Partial<BookMove> = {}): BookRow => ({
  move: move(usi, fields),
  line: null,
});

const spellings = (rows: readonly BookRow[]) => rows.map((r) => r.move.usiMove);

describe("定跡の表の並べ替え", () => {
  test("既定は定跡に書かれている順のまま", () => {
    const rows = [row("7g7f", { value: 10 }), row("2g2f", { value: 999 })];

    expect(spellings(sortBookRows(rows, DEFAULT_BOOK_SORT))).toEqual(["7g7f", "2g2f"]);
  });

  test("元の配列を変えない", () => {
    const rows = [row("7g7f", { value: 10 }), row("2g2f", { value: 999 })];

    sortBookRows(rows, { key: "value", desc: true });

    expect(spellings(rows)).toEqual(["7g7f", "2g2f"]);
  });

  /**
   * **欠けている欄は向きに関わらず下。**
   *
   * 昇順で上へ来させると、「出現回数の少ない順」を押しただけで
   * 回数の分かっていない手が一面に出る（欠けているのは 0 回ではない）。
   */
  test("欄が欠けている行は、昇順でも降順でも下に来る", () => {
    const rows = [row("7g7f"), row("2g2f", { count: 5 }), row("3g3f", { count: 900 })];

    expect(spellings(sortBookRows(rows, { key: "count", desc: true }))).toEqual([
      "3g3f",
      "2g2f",
      "7g7f",
    ]);
    expect(spellings(sortBookRows(rows, { key: "count", desc: false }))).toEqual([
      "2g2f",
      "3g3f",
      "7g7f",
    ]);
  });

  test("同点は定跡が書いた順のまま", () => {
    const rows = [row("7g7f", { value: 50 }), row("2g2f", { value: 50 })];

    expect(spellings(sortBookRows(rows, { key: "value", desc: true }))).toEqual(["7g7f", "2g2f"]);
  });

  test("別の列を押すと大きい順から始まり、同じ列で向きが返る", () => {
    const first = nextBookSort(DEFAULT_BOOK_SORT, "value");
    expect(first).toEqual({ key: "value", desc: true });

    expect(nextBookSort(first, "value")).toEqual({ key: "value", desc: false });
    expect(nextBookSort(first, "depth")).toEqual({ key: "depth", desc: true });
  });

  test("指し手の列を押すと定跡の順へ戻る", () => {
    expect(nextBookSort({ key: "value", desc: false }, "book")).toEqual(DEFAULT_BOOK_SORT);
  });
});

describe("出現回数のバー", () => {
  test("一覧の最大値を 1 とする相対の長さになる", () => {
    expect(countBarRatio(50, 100)).toBe(0.5);
    expect(countBarRatio(100, 100)).toBe(1);
  });

  /** 0 除算で `NaN` が幅に入ると、バーが消えるのではなく行の高さが変わる */
  test("最大が 0 でも NaN にならない", () => {
    expect(countBarRatio(0, 0)).toBe(0);
    expect(countBarRatio(null, 0)).toBe(0);
  });

  test("欄が欠けている行は長さ 0", () => {
    expect(countBarRatio(null, 100)).toBe(0);
  });

  test("最大値は、欄が欠けている行を数えない", () => {
    expect(maxCount([row("7g7f"), row("2g2f", { count: 7 })])).toBe(7);
    expect(maxCount([row("7g7f")])).toBe(0);
  });
});

describe("辿った結果の突き合わせ", () => {
  const line = (usi: string, plies: number): BookLine => ({
    usiMove: usi,
    plies,
    stopped: "outOfBook",
  });

  /**
   * **添字ではなく綴りで突き合わせる。**
   *
   * 添字で配ると、並べ替えた後の一覧に当てたときに黙って別の手の長さが出る。
   * 返る順を入れ替えてあるので、添字で配る実装はここで落ちる。
   */
  test("並びが違っても、手の綴りで配られる", () => {
    const moves = [move("7g7f"), move("2g2f")];
    const rows = attachLines(moves, [line("2g2f", 9), line("7g7f", 3)]);

    expect(rows.map((r) => [r.move.usiMove, r.line?.plies])).toEqual([
      ["7g7f", 3],
      ["2g2f", 9],
    ]);
  });

  test("辿った結果の無い手は `null` のまま", () => {
    const rows = attachLines([move("7g7f"), move("2g2f")], [line("7g7f", 3)]);

    expect(rows[1].line).toBeNull();
  });
});
