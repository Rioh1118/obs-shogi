// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";
import { BookProvider, useBook, type BookContextType } from "@/entities/book";
import { Err, Ok } from "@/shared/lib/result";
import { useBookOpening } from "../useBookOpening";

const { openBookFile, setDisplayConfig, pickBookFile } = vi.hoisted(() => ({
  openBookFile: vi.fn(),
  setDisplayConfig: vi.fn(),
  pickBookFile: vi.fn(),
}));

vi.mock("@/shared/api/picker/pickBookFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/picker/pickBookFile")>();
  const mocked = { ...actual, pickBookFile };
  return mocked satisfies typeof import("@/shared/api/picker/pickBookFile");
});

vi.mock(
  "@/entities/book/api/commands",
  async (importOriginal) =>
    ({
      ...(await importOriginal<typeof import("@/entities/book/api/commands")>()),
      openBookFile,
      closeBook: () => Promise.resolve(Ok(undefined)),
      listBooks: () => Promise.resolve(Ok([])),
      lookupBookMoves: () => new Promise(() => {}),
    }) satisfies typeof import("@/entities/book/api/commands"),
);

vi.mock(
  "@/entities/app-config",
  async (importOriginal) =>
    ({
      ...(await importOriginal<typeof import("@/entities/app-config")>()),
      useAppConfig: () =>
        ({
          config: { book_recent_paths: ["/books/old.db"] },
          setDisplayConfig,
        }) as unknown as ReturnType<typeof import("@/entities/app-config").useAppConfig>,
    }) satisfies typeof import("@/entities/app-config"),
);

const wrapper = ({ children }: { children: ReactNode }) => (
  <BookProvider currentSfen={null}>{children}</BookProvider>
);

const info = (handle: number, path: string) => ({
  handle,
  path,
  format: "yaneuraouDb" as const,
  positionCount: 1,
  droppedFields: 0,
});

function renderOpening() {
  let book!: BookContextType;
  const { result } = renderHook(
    () => {
      book = useBook();
      return useBookOpening();
    },
    { wrapper },
  );
  return { result, close: () => book.close(), failure: () => book.failure };
}

beforeEach(() => {
  openBookFile.mockReset();
  pickBookFile.mockReset();
  setDisplayConfig.mockReset().mockResolvedValue(Ok(undefined));
});

afterEach(() => cleanup());

describe("最近開いた定跡への控え", () => {
  it("開けた定跡を先頭に控える", async () => {
    openBookFile.mockResolvedValue(Ok(info(1, "/books/a.db")));
    const { result } = renderOpening();

    await act(async () => {
      await result.current.open("/books/a.db");
    });

    expect(setDisplayConfig).toHaveBeenCalledWith({
      book_recent_paths: ["/books/a.db", "/books/old.db"],
    });
  });

  /** 控えると、後から開いた定跡を古い一覧で上書きし、捨てた定跡が先頭に来る */
  it("中止した定跡は控えない", async () => {
    let settle!: (value: unknown) => void;
    openBookFile.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const { result, close } = renderOpening();

    let opening!: Promise<void>;
    act(() => {
      opening = result.current.open("/books/big.db");
    });
    act(() => close());
    await act(async () => {
      settle(Ok(info(1, "/books/big.db")));
      await opening;
    });

    expect(setDisplayConfig).not.toHaveBeenCalled();
  });

  it("開けなかった定跡は控えない", async () => {
    openBookFile.mockResolvedValue(Err({ code: "io", message: "読めない", path: "/books/a.db" }));
    const { result } = renderOpening();

    await act(async () => {
      await result.current.open("/books/a.db");
    });

    expect(setDisplayConfig).not.toHaveBeenCalled();
  });
});

describe("ダイアログで選んで開く", () => {
  it("選んだ定跡を開いて控える", async () => {
    pickBookFile.mockResolvedValue("/books/a.db");
    openBookFile.mockResolvedValue(Ok(info(1, "/books/a.db")));
    const { result } = renderOpening();

    await act(async () => {
      await result.current.browse();
    });

    expect(openBookFile).toHaveBeenCalledWith("/books/a.db");
    expect(setDisplayConfig).toHaveBeenCalledTimes(1);
  });

  it("取り消したら何も開かない", async () => {
    pickBookFile.mockResolvedValue(null);
    const { result, failure } = renderOpening();

    await act(async () => {
      await result.current.browse();
    });

    expect(openBookFile).not.toHaveBeenCalled();
    expect(failure()).toBeNull();
  });

  /** 黙って落とすと、📂 を押しても反応しない画面になる */
  it("ダイアログが開けなければ、失敗の帯へ渡す", async () => {
    pickBookFile.mockRejectedValue(new Error("権限が無い"));
    const { result, failure } = renderOpening();

    await act(async () => {
      await result.current.browse();
    });

    expect(openBookFile).not.toHaveBeenCalled();
    expect(failure()?.origin).toBe("external");
    expect(failure()?.error.message).toContain("定跡を選択する画面を開けませんでした");
    expect(failure()?.error.message).toContain("権限が無い");
  });
});
