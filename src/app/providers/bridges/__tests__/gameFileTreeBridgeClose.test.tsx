// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import type { JKFData } from "@/entities/kifu/model/jkf";
import type { NotifyRequest } from "@/shared/lib/notification/types";
import { Err, Ok } from "@/shared/lib/result";

/**
 * 棋譜を閉じたときに盤を空けることと、閉じた後に同じ内容をもう一度開いたら載せ直すこと。
 *
 * 閉じたのに盤を空けないと、`WelcomeScreen` に戻らず前の棋譜が残る。
 * 閉じたときにref に入れた `jkfData` を捨てないと、同じ `jkfData` で開き直したのを改名と取り違え、
 * 盤に載らないまま宛先だけが動く。形式が分からない棋譜も載せない。
 */

const tree = {
  activeKifuPath: null as string | null,
  jkfData: null as JKFData | null,
  kifuFormat: "kif" as string | null,
};
const loadGame = vi.fn();
const renameLoadedPath = vi.fn();
const resetGame = vi.fn();
const notify = vi.fn<(request: NotifyRequest) => void>();

vi.mock("@/entities/file-tree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/file-tree")>();
  const mocked = { ...actual, useFileTree: (() => tree) as unknown as typeof actual.useFileTree };
  return mocked satisfies typeof import("@/entities/file-tree");
});
vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = {
    ...actual,
    useGame: (() => ({
      loadGame,
      renameLoadedPath,
      resetGame,
    })) as unknown as typeof actual.useGame,
  };
  return mocked satisfies typeof import("@/entities/game");
});
vi.mock("@/shared/lib/notification/useNotifications", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/shared/lib/notification/useNotifications")>();
  const mocked = {
    ...actual,
    useNotify: (() => ({
      notify,
      dismiss: vi.fn(),
      dismissByKey: vi.fn(),
    })) as unknown as typeof actual.useNotify,
  };
  return mocked satisfies typeof import("@/shared/lib/notification/useNotifications");
});

const { GameFileTreeBridge } = await import("../GameFileTreeBridge");

const JKF: JKFData = { header: {}, moves: [{}] };

async function show(path: string | null, jkf: JKFData | null, view?: ReturnType<typeof render>) {
  tree.activeKifuPath = path;
  tree.jkfData = jkf;
  let out = view;
  await act(async () => {
    if (out) out.rerender(<GameFileTreeBridge />);
    else out = render(<GameFileTreeBridge />);
  });
  return out!;
}

beforeEach(() => {
  tree.kifuFormat = "kif";
  loadGame.mockReset().mockResolvedValue(Ok(undefined));
  renameLoadedPath.mockReset();
  resetGame.mockReset();
  notify.mockReset();
});
afterEach(cleanup);

describe("棋譜を閉じたとき", () => {
  test("盤を空ける", async () => {
    const view = await show("/ws/a.kif", JKF);
    resetGame.mockClear();

    await show(null, null, view);

    expect(resetGame).toHaveBeenCalledTimes(1);
  });

  test("閉じた後に同じ内容で開き直したら、改名ではなく載せ直す", async () => {
    const view = await show("/ws/a.kif", JKF);
    await show(null, null, view);
    loadGame.mockClear();

    await show("/ws/a.kif", JKF, view);

    expect(loadGame).toHaveBeenCalledTimes(1);
    expect(renameLoadedPath).not.toHaveBeenCalled();
  });

  test("形式が分からない棋譜は載せず、盤を空ける", async () => {
    tree.kifuFormat = null;
    await show("/ws/a.kif", JKF);

    expect(loadGame).not.toHaveBeenCalled();
    expect(resetGame).toHaveBeenCalledTimes(1);
  });
});

describe("載せられなかったとき", () => {
  test("題にはフォルダを除いたファイル名を出す", async () => {
    loadGame.mockResolvedValue(Err({ code: "invalid_initial", message: "x" }));
    await show("/ws/deep/a.kif", JKF);

    const request = notify.mock.calls[0][0];
    expect(request.tier !== "silent" && request.title).toBe("「a.kif」を盤に並べられませんでした");
  });
});
