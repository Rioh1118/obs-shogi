// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import { GameProvider, useGame, type GameContextType } from "@/entities/game";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { kifuListMarker } from "@/features/kifu-navigation-keys/lib/kifuListMarker";
import { Ok } from "@/shared/lib/result";
import { useKifuNavigationKeys } from "../useKifuNavigationKeys";

/**
 * 押したキーで棋譜のどこへ動くか。どのキーを受けるかは `navigationKey.test.ts` が見る。
 */

const KIFU = parseKifuContentToJKF(
  [
    "手合割：平手",
    "   1 ７六歩(77)",
    "   2 ３四歩(33)",
    "   3 ２六歩(27)",
    "   4 ８四歩(83)",
    "",
  ].join("\n"),
  "kif",
);

/** 描くのを待っているフレーム */
let frames: FrameRequestCallback[] = [];

/** 画面が1回描かれる */
function paint() {
  for (const frame of frames.splice(0)) frame(0);
}

async function mount({ load = true, list = true } = {}) {
  const game: { current: GameContextType | null } = { current: null };

  function Page() {
    game.current = useGame();
    useKifuNavigationKeys();
    return (
      <>
        <button type="button">外</button>
        {list && <div {...kifuListMarker} tabIndex={0} data-testid="list" />}
      </>
    );
  }

  const view = render(
    <GameProvider persistence={{ absPath: "/w/a.kif", save: async () => Ok(undefined) }}>
      <Page />
    </GameProvider>,
  );
  if (load) {
    await act(async () => {
      expect((await game.current!.loadGame(KIFU, "/w/a.kif")).success).toBe(true);
    });
  }

  return {
    unmount: view.unmount,
    outside: view.getByRole("button", { name: "外" }),
    list: view.queryByTestId("list"),
    tesuu: () => game.current!.state.cursor?.tesuu,
    run: async (action: () => void) => {
      await act(async () => action());
    },
    /** 既定の動作を止めたかを返す */
    press: async (key: string, init: KeyboardEventInit = {}) => {
      let untouched = true;
      await act(async () => {
        untouched = fireEvent.keyDown(document.body, { key, ...init });
      });
      return { prevented: !untouched };
    },
    game: () => game.current!,
  };
}

beforeEach(() => {
  frames = [];
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((frame) => {
    frames.push(frame);
    return frames.length;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("キーと移動", () => {
  test("→ で次の手、← で前の手", async () => {
    const { press, tesuu } = await mount();

    await press("ArrowRight");
    await press("ArrowRight");
    expect(tesuu()).toBe(2);

    await press("ArrowLeft");
    expect(tesuu()).toBe(1);
  });

  test("End で最後、Home で最初", async () => {
    const { press, tesuu } = await mount();

    await press("End");
    expect(tesuu()).toBe(4);

    await press("Home");
    expect(tesuu()).toBe(0);
  });

  test("一覧の外の ↓ は、動かさず、既定の動作も止めない", async () => {
    const { press, tesuu } = await mount();

    expect(await press("ArrowDown")).toEqual({ prevented: false });
    expect(tesuu()).toBe(0);
  });
});

describe("フォーカス", () => {
  test("動かしたら、棋譜の一覧へ移す", async () => {
    const { press, outside, list } = await mount();
    act(() => outside.focus());

    await press("ArrowRight");

    expect(document.activeElement).toBe(list);
  });

  test("受けなかったキーでは、動かさない", async () => {
    const { press, outside } = await mount();
    act(() => outside.focus());

    await press("PageDown");
    await press("ArrowDown");
    await press("ArrowRight", { metaKey: true });

    expect(document.activeElement).toBe(outside);
  });

  test("流さずに移す", async () => {
    const { press, list } = await mount();
    const focus = vi.spyOn(list!, "focus");

    await press("ArrowRight");

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  test("一覧が描かれていなくても、局面は動く", async () => {
    const { press, outside, tesuu } = await mount({ list: false });
    act(() => outside.focus());

    await press("ArrowRight");

    expect(tesuu()).toBe(1);
    expect(document.activeElement).toBe(outside);
  });
});

describe("既定の動作", () => {
  test("端で動けないときも止める", async () => {
    const { press, tesuu } = await mount();

    expect(await press("ArrowLeft")).toEqual({ prevented: true });
    expect(tesuu()).toBe(0);
  });

  test("受けないキーは止めない", async () => {
    const { press } = await mount();

    expect(await press("PageDown")).toEqual({ prevented: false });
    expect(await press("ArrowRight", { metaKey: true })).toEqual({ prevented: false });
  });
});

describe("押し続けたとき", () => {
  test("描くまでは、次の分を動かさない", async () => {
    const { press, tesuu } = await mount();

    await press("ArrowRight");
    expect(await press("ArrowRight", { repeat: true })).toEqual({ prevented: true });
    await press("ArrowRight", { repeat: true });
    expect(tesuu()).toBe(1);
  });

  test("描くたびに1手ずつ動く", async () => {
    const { press, tesuu } = await mount();

    await press("ArrowRight");
    paint();
    await press("ArrowRight", { repeat: true });
    paint();
    await press("ArrowRight", { repeat: true });
    expect(tesuu()).toBe(3);
  });

  test("押し直した分は、描く前でも動く", async () => {
    const { press, tesuu } = await mount();

    await press("ArrowRight");
    await press("ArrowRight");
    expect(tesuu()).toBe(2);
  });
});

describe("棋譜が無いとき", () => {
  test("受けない", async () => {
    const { press } = await mount({ load: false });

    expect(await press("ArrowRight")).toEqual({ prevented: false });
  });

  test("閉じた後は受けない", async () => {
    const { press, run, game } = await mount();

    await run(() => game().resetGame());

    expect(await press("ArrowRight")).toEqual({ prevented: false });
  });

  test("画面から外れた後は受けない", async () => {
    const { press, unmount } = await mount();

    unmount();

    expect(await press("ArrowRight")).toEqual({ prevented: false });
  });
});

describe("盤で駒を選んでいるとき", () => {
  test("動いたら選択を外す", async () => {
    const { press, run, game } = await mount();
    await run(() => game().selectSquare(7, 7));
    expect(game().state.selectedPosition).not.toBeNull();

    await press("ArrowRight");

    expect(game().state.selectedPosition).toBeNull();
  });
});
