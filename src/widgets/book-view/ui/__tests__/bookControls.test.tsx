// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BookProvider } from "@/entities/book";
import { Ok } from "@/shared/lib/result";

/**
 * 定跡ビューの操作列の押下と表示。
 *
 * 📂 と ✕ は Rust の定跡のハンドルへ届く。押したときに開く・閉じるハンドルと、
 * 押せる条件をここで固定する。遷移そのものは `docs/state-transitions/book-view.md`。
 */

const { openBookFile, closeBook, pickBookFile } = vi.hoisted(() => ({
  openBookFile: vi.fn(),
  closeBook: vi.fn(),
  pickBookFile: vi.fn(),
}));

vi.mock("@/entities/book/api/commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/book/api/commands")>();
  const mocked = {
    ...actual,
    openBookFile,
    closeBook,
    listBooks: () => Promise.resolve(Ok([])),
    lookupBookMoves: () => new Promise<never>(() => {}),
  };
  return mocked satisfies typeof import("@/entities/book/api/commands");
});

vi.mock("@/shared/api/picker/pickBookFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/api/picker/pickBookFile")>();
  const mocked = { ...actual, pickBookFile };
  return mocked satisfies typeof import("@/shared/api/picker/pickBookFile");
});

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const appConfig = {
    config: { book_recent_paths: [] },
    setDisplayConfig: () => Promise.resolve(Ok(undefined)),
  } as unknown as ReturnType<typeof actual.useAppConfig>;
  const mocked = { ...actual, useAppConfig: () => appConfig };
  return mocked satisfies typeof import("@/entities/app-config");
});

const { default: BookControls } = await import("../BookControls");

const info = (handle: number, path: string, extra: object = {}) => ({
  handle,
  path,
  format: "yaneuraouDb" as const,
  positionCount: 1234,
  droppedFields: 0,
  ...extra,
});

function mount() {
  return render(
    <BookProvider currentSfen={null}>
      <BookControls />
    </BookProvider>,
  );
}

const openButton = () => screen.getByRole("button", { name: "定跡を開く" });
const closeButton = () =>
  screen.getByRole("button", { name: /定跡を閉じる|開くのを中止/ }) as HTMLButtonElement;
const text = (view: ReturnType<typeof mount>) => view.container.textContent ?? "";

/** 📂 を押し、ダイアログが `path` を返すまで待つ。`null` は取り消し */
async function openVia(path: string | null) {
  pickBookFile.mockResolvedValueOnce(path);
  await act(async () => {
    fireEvent.click(openButton());
  });
}

beforeEach(() => {
  openBookFile.mockReset();
  closeBook.mockReset().mockResolvedValue(Ok(undefined));
  pickBookFile.mockReset();
});

afterEach(() => cleanup());

describe("定跡を開いていないとき", () => {
  test("開いていないと言い、✕ は押せない", () => {
    const view = mount();

    expect(text(view)).toContain("定跡を開いていません");
    expect(closeButton().disabled).toBe(true);
    expect((openButton() as HTMLButtonElement).disabled).toBe(false);
  });

  test("📂 で選んだ定跡を開き、名前と局面数を出す", async () => {
    openBookFile.mockResolvedValue(Ok(info(1, "/books/a.db")));
    const view = mount();

    await openVia("/books/a.db");

    expect(openBookFile).toHaveBeenCalledWith("/books/a.db");
    expect(text(view)).toContain("a.db");
    expect(text(view)).toContain(`${(1234).toLocaleString()} 局面`);
    expect(text(view)).not.toContain("読めない欄");
  });

  test("ダイアログを取り消したら何も開かない", async () => {
    mount();

    await openVia(null);

    expect(openBookFile).not.toHaveBeenCalled();
  });
});

describe("定跡を開いているとき", () => {
  test("読めなかった欄があれば数を出す", async () => {
    openBookFile.mockResolvedValue(Ok(info(1, "/books/a.db", { droppedFields: 3 })));
    const view = mount();

    await openVia("/books/a.db");

    expect(text(view)).toContain("読めない欄 3");
  });

  /** 0 と同じ綴りにすると、局面数の書かれていない定跡が空の定跡に見える */
  test("局面数を数えられない形式は、0 局面と言わない", async () => {
    openBookFile.mockResolvedValue(Ok(info(1, "/books/a.bin", { positionCount: null })));
    const view = mount();

    await openVia("/books/a.bin");

    expect(text(view)).toContain("局面数は数えられない形式");
    expect(text(view)).not.toContain("0 局面");
  });

  test("✕ は開いているハンドルを閉じ、開いていない画面へ戻る", async () => {
    openBookFile.mockResolvedValue(Ok(info(7, "/books/a.db")));
    const view = mount();
    await openVia("/books/a.db");

    expect(closeButton().title).toBe("定跡を閉じる");
    act(() => fireEvent.click(closeButton()));

    expect(closeBook).toHaveBeenCalledWith(7);
    expect(text(view)).toContain("定跡を開いていません");
  });
});

describe("開いている最中", () => {
  test("開こうとしている名前を出し、📂 は押せず ✕ は中止になる", async () => {
    openBookFile.mockReturnValue(new Promise(() => {}));
    const view = mount();

    await openVia("/books/big.db");

    expect(text(view)).toContain("big.db");
    expect(text(view)).not.toContain("定跡を開いていません");
    expect((openButton() as HTMLButtonElement).disabled).toBe(true);
    expect(closeButton().disabled).toBe(false);
    expect(closeButton().title).toBe("開くのを中止");
  });

  /** 捨てないと、中止したはずの定跡が数分後に開く（※D） */
  test("中止した後に返ったハンドルは閉じて捨てる", async () => {
    let settle!: (value: unknown) => void;
    openBookFile.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const view = mount();
    await openVia("/books/big.db");

    act(() => fireEvent.click(closeButton()));
    expect(text(view)).toContain("定跡を開いていません");

    await act(async () => {
      settle(Ok(info(9, "/books/big.db")));
    });

    expect(closeBook).toHaveBeenCalledWith(9);
    expect(text(view)).toContain("定跡を開いていません");
  });

  /**
   * 開き直しの途中の ✕ は、開いていた定跡まで閉じる。題は「開くのを中止」なので、
   * 中止で前の定跡へ戻すかは `docs/readability-progress.md` の所見の表で決める。
   * 決まるまでは今の動きをここで固定し、変えたら落ちるようにしておく。
   */
  test("開き直しの途中で中止すると、開いていた定跡も閉じる", async () => {
    openBookFile.mockResolvedValueOnce(Ok(info(1, "/books/a.db")));
    const view = mount();
    await openVia("/books/a.db");

    openBookFile.mockReturnValueOnce(new Promise(() => {}));
    await openVia("/books/b.db");
    expect(closeButton().title).toBe("開くのを中止");

    act(() => fireEvent.click(closeButton()));

    expect(closeBook).toHaveBeenCalledWith(1);
    expect(text(view)).toContain("定跡を開いていません");
  });
});
