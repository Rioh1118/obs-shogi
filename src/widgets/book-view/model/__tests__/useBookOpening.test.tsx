// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReactNode } from "react";
import { BookProvider, useBook, type BookContextType } from "@/entities/book";
import { Ok } from "@/shared/lib/result";
import { useBookOpening } from "../useBookOpening";

const { openBookFile, setDisplayConfig } = vi.hoisted(() => ({
  openBookFile: vi.fn(),
  setDisplayConfig: vi.fn(),
}));

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
  return { result, close: () => book.close() };
}

beforeEach(() => {
  openBookFile.mockReset();
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
});
