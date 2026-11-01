import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeBook, listBooks, lookupBookMoves, openBookFile, walkBookLines } from "../commands";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock(
  "@tauri-apps/api/core",
  async (importOriginal) =>
    ({
      ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
      invoke,
    }) satisfies typeof import("@tauri-apps/api/core"),
);

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(null);
});

describe("定跡のコマンド", () => {
  it("引数を input に包んで渡す", async () => {
    const opened = await openBookFile("/books/a.db");
    const looked = await lookupBookMoves(1, "sfen");
    const walked = await walkBookLines(1, "sfen", ["7g7f"]);
    const closed = await closeBook(1);
    const results = [opened, looked, walked, closed];

    expect(results.every((result) => result.success)).toBe(true);
    expect(invoke.mock.calls).toEqual([
      ["open_book", { input: { path: "/books/a.db" } }],
      ["lookup_book_moves", { input: { handle: 1, sfen: "sfen" } }],
      ["walk_book_lines", { input: { handle: 1, sfen: "sfen", moves: ["7g7f"] } }],
      ["close_book", { input: { handle: 1 } }],
    ]);
  });

  it("成功は Ok で返す", async () => {
    invoke.mockResolvedValue([]);

    expect(await lookupBookMoves(1, "sfen")).toEqual({ success: true, data: [] });
  });

  it("reject は BookError の Err にする", async () => {
    invoke.mockRejectedValue({ code: "invalid_handle", message: "閉じています", path: null });

    expect(await closeBook(1)).toEqual({
      success: false,
      error: { code: "invalid_handle", message: "閉じています", path: null },
    });
  });

  it("list_books は引数を持たない", async () => {
    invoke.mockResolvedValue([]);

    await listBooks();

    expect(invoke).toHaveBeenCalledWith("list_books");
  });
});
