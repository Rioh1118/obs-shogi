// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { BookContextType, BookError, BookViewState } from "@/entities/book";

/**
 * 定跡ビューが、状態ごとに**1つのことだけ**を言うこと
 * （`docs/state-transitions/book-view.md` の不変条件2）。
 *
 * **文言そのものを固定する。** 引けなかった回に「この局面はこの定跡に
 * ありません」と出す形が実際に在り、それはこの画面でいちばん誤解が高くつく ——
 * 利用者は*定跡の中身についての事実*として読み、自分の定跡を誤って判断する。
 * 状態の綴りだけを見ると、割り当てを入れ替える変異が緑で通る。
 *
 * 状態そのものの遷移は `entities/book/model/__tests__/provider.test.tsx`。
 */

const INITIAL_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";

const book = {
  info: null,
  view: { kind: "closed" } as BookViewState,
  error: null as BookError | null,
  openBook: vi.fn(),
  close: vi.fn(),
  reportError: vi.fn(),
} satisfies Partial<BookContextType> as unknown as BookContextType;

vi.mock("@/entities/book", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/entities/book")>()),
  useBook: () => book,
}));
vi.mock("@/entities/game", () => ({
  useGame: () => ({
    state: { cursor: { tesuu: 4 } },
    view: { currentSfen: INITIAL_SFEN },
  }),
}));
vi.mock("@/entities/app-config", () => ({
  useAppConfig: () => ({ config: { book_recent_paths: [] }, setDisplayConfig: vi.fn() }),
}));
vi.mock("@/entities/engine-presets/model/useEnginePresets", () => ({
  useEnginePresets: () => ({ state: { presets: [], selectedPresetId: null } }),
}));

const { default: BookView } = await import("../BookView");

function show(view: BookViewState, error: BookError | null = null) {
  book.view = view;
  book.error = error;
  return render(<BookView />).container.textContent ?? "";
}

afterEach(() => cleanup());

describe("定跡ビューの状態と文言", () => {
  test("定跡を開いていないときは、開く導線を出す", () => {
    expect(show({ kind: "closed" })).toContain("別の定跡を開く");
  });

  /** GB 級は数分返らない。無効になったボタンだけだと押し損ねたと読まれる */
  test("開いている最中は、開こうとしているファイル名を出す", () => {
    const text = show({ kind: "opening", path: "/books/user_book1.db" });

    expect(text).toContain("user_book1.db");
    expect(text).toContain("開いています");
  });

  test("引いている最中は、引いていることを出す", () => {
    expect(show({ kind: "looking" })).toContain("引いています");
  });

  /**
   * **ここが取り違えのいちばん高くつくところ。**
   *
   * 割り当てを入れ替える変異（`unavailable` に `absent` の文言を割り当てる）は
   * ここで落ちる。
   */
  test("定跡に無いのと、引けなかったのを別の文言で出す", () => {
    const absent = show({ kind: "absent" });
    cleanup();
    const unavailable = show({ kind: "unavailable" });

    expect(absent).toContain("この定跡にありません");
    expect(unavailable).not.toContain("この定跡にありません");
    expect(unavailable).toContain("引けませんでした");
  });

  test("盤に局面が無いときは、引いている最中と言わない", () => {
    const text = show({ kind: "noPosition" });

    expect(text).toContain("盤に局面がありません");
    expect(text).not.toContain("引いています");
  });

  /**
   * **行が並んでいるのに「読めませんでした」と言わない。**
   * 行が出ているのは引けたということなので、落ちたのは先を辿る側だけ。
   */
  test("行が出ているときの失敗の題は、辿る側の失敗として出る", () => {
    const failure: BookError = { code: "io", message: "読み書きに失敗", path: null };
    const rows = show(
      {
        kind: "rows",
        rows: [
          {
            move: { usiMove: "7g7f", ponder: null, value: 42, depth: 32, count: 5 },
            line: { state: "failed" },
          },
        ],
      },
      failure,
    );

    expect(rows).toContain("定跡の先を辿れませんでした");
    cleanup();

    expect(show({ kind: "unavailable" }, failure)).toContain("定跡を読めませんでした");
  });

  /** 辿るのをやめた後に「辿っています」と言わない（不変条件3） */
  test("辿れなかった行は、まだ辿っている行と別の綴りになる", () => {
    const move = { usiMove: "7g7f", ponder: null, value: null, depth: null, count: null };
    const failed = show({ kind: "rows", rows: [{ move, line: { state: "failed" } }] });
    cleanup();
    const pending = show({ kind: "rows", rows: [{ move, line: { state: "pending" } }] });

    expect(failed).not.toBe(pending);
  });
});
