// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_BOOK_SORT, type BookRow, type BookSort } from "@/entities/book";
import BookTable from "../BookTable";

/**
 * 定跡の表の並べ替えと欄の綴り。
 *
 * 欄が欠けているのと 0 は別のことなので、同じ綴りにすると定跡の中身を読み違える。
 * 並べ替えの見出しは状態を呼び手へ返すだけで、押した結果は呼び手が持つ。
 */

const INITIAL_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const row = (usiMove: string, move: Partial<BookRow["move"]> = {}): BookRow => ({
  move: { usiMove, ponder: null, value: null, depth: null, count: null, ...move },
  line: { state: "walked", line: { usiMove, plies: 3, stopped: "outOfBook" } },
});

const ROWS: BookRow[] = [
  row("2g2f", { value: -12, depth: 20, count: 0 }),
  row("7g7f", { value: 42, depth: 32, count: 1200, ponder: "3c3d" }),
  row("5g5f", { value: 0 }),
];

function mount(props: { rows?: BookRow[]; sort?: BookSort; empty?: string } = {}) {
  const onSort = vi.fn();
  render(
    <BookTable
      rows={props.rows ?? ROWS}
      sfen={INITIAL_SFEN}
      baseTesuu={4}
      sort={props.sort ?? DEFAULT_BOOK_SORT}
      onSort={onSort}
      empty={props.empty ?? "空"}
    />,
  );
  return { onSort };
}

/** 本体の行を、セルの文字の並びで返す */
function bodyRows(): string[][] {
  const [, body] = screen.getAllByRole("rowgroup");
  return within(body)
    .getAllByRole("row")
    .map((tr) =>
      within(tr)
        .getAllByRole("cell")
        .map((td) => td.textContent ?? ""),
    );
}

const sortButton = (label: string) => screen.getByRole("button", { name: new RegExp(label) });

afterEach(() => cleanup());

describe("定跡の表の欄", () => {
  test("評価値は符号を付け、欠けた欄は — で出す", () => {
    mount();

    const [first, second, third] = bodyRows();
    // 定跡に書かれている順のまま
    expect(first[0]).toBe("☗２六歩");
    expect(first[1]).toBe("-12");
    expect(second[1]).toBe("+42");
    expect(third[1]).toBe("0");
    expect(third[2]).toBe("—");
  });

  test("出現回数は欠けた欄と 0 回を別の綴りにし、桁を区切る", () => {
    mount();

    const [first, second, third] = bodyRows();
    expect(first[3]).toBe("0");
    expect(second[3]).toBe((1200).toLocaleString());
    expect(third[3]).toBe("—");
  });

  test("応手は日本語にし、無ければ — を出す", () => {
    mount();

    const [first, second] = bodyRows();
    expect(second[4]).toBe("☖３四歩");
    expect(first[4]).toBe("—");
  });

  test("この先の列は現局面の手数を土台に絶対手数で出す", () => {
    mount();

    expect(bodyRows()[0][5]).toBe("→ 7手目");
  });

  test("出現回数の棒は一覧の最大値を 1 とする長さになる", () => {
    const { container } = render(
      <BookTable
        rows={[row("7g7f", { count: 50 }), row("2g2f", { count: 200 })]}
        sfen={INITIAL_SFEN}
        baseTesuu={0}
        sort={DEFAULT_BOOK_SORT}
        onSort={() => {}}
        empty=""
      />,
    );

    const fills = [...container.querySelectorAll<HTMLElement>("[aria-hidden='true'][style]")].map(
      (bar) => bar.style.getPropertyValue("--book-bar-fill"),
    );
    expect(fills).toEqual(["25%", "100%"]);
  });

  test("行が無ければ見出しを残したまま文言を出す", () => {
    mount({ rows: [], empty: "引いています…" });

    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(bodyRows()).toEqual([["引いています…"]]);
  });
});

describe("定跡の表の並べ替え", () => {
  test("渡された並びで行を並べる", () => {
    mount({ sort: { key: "value", desc: true } });

    expect(bodyRows().map((cells) => cells[1])).toEqual(["+42", "0", "-12"]);
  });

  test("見出しを押すと次の並びを呼び手へ返す", () => {
    const { onSort } = mount({ sort: { key: "value", desc: true } });

    fireEvent.click(sortButton("評価"));
    expect(onSort).toHaveBeenLastCalledWith({ key: "value", desc: false });

    fireEvent.click(sortButton("出現回数"));
    expect(onSort).toHaveBeenLastCalledWith({ key: "count", desc: true });

    fireEvent.click(sortButton("指し手"));
    expect(onSort).toHaveBeenLastCalledWith(DEFAULT_BOOK_SORT);
  });

  test("並べている列だけが向きを名乗り、記号で向きを出す", () => {
    mount({ sort: { key: "depth", desc: false } });

    const headers = screen.getAllByRole("columnheader");
    const sortOf = (label: string) =>
      headers.find((th) => th.textContent?.startsWith(label))?.getAttribute("aria-sort");

    expect(sortOf("深さ")).toBe("ascending");
    expect(sortOf("評価")).toBe("none");
    expect(sortButton("深さ").textContent).toBe("深さ▴");
    expect(sortButton("評価").textContent).toBe("評価");

    cleanup();
    mount({ sort: { key: "depth", desc: true } });
    expect(sortButton("深さ").textContent).toBe("深さ▾");
  });
});
