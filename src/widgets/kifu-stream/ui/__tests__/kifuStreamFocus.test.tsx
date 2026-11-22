// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { GameProvider, useGame, type GameContextType } from "@/entities/game";
import { parseKifuContentToJKF } from "@/entities/kifu/api/parse";
import { useKifuNavigationKeys } from "@/features/kifu-navigation-keys";
import { Ok } from "@/shared/lib/result";
import KifuStreamList from "../KifuStreamList";

/**
 * 棋譜の一覧で選ばれて見える行は、いまの手の1つだけ。
 *
 * 行がフォーカスを持つと、右クリックや分岐のメニューのあとで、輪だけがいまの手と別の行に残る。
 * 止まったポインタの下の行にホバーの背景が付くと、いまの手と2つ選ばれて見える。
 * 輪とホバーの見た目は `kifuRowMarks.ratchet.test.ts` が見る。
 */

/** 本譜3手。2手目に変化が1本 */
const KIFU = parseKifuContentToJKF(
  [
    "手合割：平手",
    "   1 ７六歩(77)",
    "   2 ３四歩(33)",
    "   3 ２六歩(27)",
    "",
    "変化：2手",
    "   2 ８四歩(83)",
    "",
  ].join("\n"),
  "kif",
);

async function mount() {
  const game: { current: GameContextType | null } = { current: null };

  function Page() {
    game.current = useGame();
    useKifuNavigationKeys();
    return (
      <>
        <button type="button">外</button>
        <KifuStreamList />
      </>
    );
  }

  const view = render(
    <GameProvider persistence={{ absPath: "/w/a.kif", save: async () => Ok(undefined) }}>
      <Page />
    </GameProvider>,
  );
  await act(async () => {
    expect((await game.current!.loadGame(KIFU, "/w/a.kif")).success).toBe(true);
  });

  return {
    outside: view.getByRole("button", { name: "外" }),
    list: view.getByRole("grid", { name: "棋譜" }),
    tesuu: () => game.current!.state.cursor?.tesuu,
    goTo: (te: number) => act(async () => game.current!.goToIndex(te)),
    saveComment: (te: number, line: string) =>
      act(async () => {
        const saved = await game.current!.setCommentsByCursor({ tesuu: te, forkPointers: [] }, [
          line,
        ]);
        expect(saved.success).toBe(true);
      }),
    press: async (key: string) => {
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key });
      });
    },
  };
}

function rowOf(te: number): HTMLElement {
  const row = document.getElementById(`kifu-row-${te}`);
  if (!row) throw new Error(`${te}手目の行が無い`);
  return row;
}

const forkButtonOf = (te: number) => within(rowOf(te)).getByTitle("分岐を選択");
const commentButtonOf = (te: number) => within(rowOf(te)).getByTitle("コメントを追加");

const focus = (el: HTMLElement) => act(async () => el.focus());

afterEach(cleanup);

describe("選ばれて見える行", () => {
  test("選ばれている行は1つで、一覧もその行を指す", async () => {
    const { list, goTo } = await mount();

    for (const te of [2, 0, 3]) {
      await goTo(te);

      const selected = [...list.querySelectorAll('[aria-selected="true"]')];
      expect(selected).toEqual([rowOf(te)]);
      expect(list.getAttribute("aria-activedescendant")).toBe(rowOf(te).id);
    }
  });

  test("行はフォーカスを持てない", async () => {
    const { list } = await mount();

    const focusableRows = [...list.querySelectorAll('[role="row"]')].filter((row) =>
      row.hasAttribute("tabindex"),
    );
    expect(focusableRows).toEqual([]);
  });

  test("Tab で止まるのは、一覧と、いまの手の行のボタンだけ", async () => {
    const { list, goTo } = await mount();
    const stops = () =>
      [list, ...list.querySelectorAll<HTMLElement>("[tabindex], button")].filter(
        (el) => el.tabIndex === 0,
      );

    await goTo(2);
    expect(stops()).toEqual([list, forkButtonOf(2), commentButtonOf(2)]);

    await goTo(1);
    expect(stops()).toEqual([list, commentButtonOf(1)]);
  });
});

describe("矢印で動かしたとき", () => {
  test("一覧にあるフォーカスは、一覧のまま", async () => {
    const { list, press, tesuu } = await mount();
    await focus(list);

    await press("ArrowDown");
    await press("ArrowRight");
    await press("ArrowUp");

    expect(tesuu()).toBe(1);
    expect(document.activeElement).toBe(list);
  });

  test("外にあるフォーカスは、一覧へ移る", async () => {
    const { list, outside, press, tesuu } = await mount();
    await focus(outside);

    await press("ArrowRight");

    expect(tesuu()).toBe(1);
    expect(document.activeElement).toBe(list);
  });

  test("どこにもフォーカスが無くても、一覧へ移る", async () => {
    const { list, press } = await mount();

    await press("ArrowRight");

    expect(document.activeElement).toBe(list);
  });

  test("いまの手の行のボタンにあるフォーカスは、一覧へ移る", async () => {
    const { list, goTo, press, tesuu } = await mount();
    await goTo(2);
    await focus(commentButtonOf(2));

    await press("ArrowDown");

    expect(tesuu()).toBe(3);
    expect(document.activeElement).toBe(list);
  });
});

describe("矢印でないもので動いたとき", () => {
  test("外にあるフォーカスは、奪わない", async () => {
    const { outside, goTo } = await mount();
    await focus(outside);

    await goTo(2);

    expect(document.activeElement).toBe(outside);
  });

  test("前の行のボタンに、フォーカスを残さない", async () => {
    const { list, goTo } = await mount();
    await goTo(2);
    await focus(forkButtonOf(2));

    await goTo(3);

    expect(document.activeElement).toBe(list);
  });
});

describe("行のボタンにフォーカスが来たとき", () => {
  test("いまの手の行なら、そのまま", async () => {
    const { goTo } = await mount();
    await goTo(2);

    await focus(forkButtonOf(2));

    expect(document.activeElement).toBe(forkButtonOf(2));
  });

  // マウスで押したときと、分岐メニューや付箋を閉じたあとに来る
  test("ほかの行なら、一覧へ戻す", async () => {
    const { list, goTo } = await mount();
    await goTo(1);

    await focus(forkButtonOf(2));

    expect(document.activeElement).toBe(list);
  });
});

describe("ポインタで指した行", () => {
  const moveTo = (el: Element, x: number, y: number) =>
    act(async () => {
      fireEvent.pointerMove(el, { clientX: x, clientY: y });
    });
  const pointed = () =>
    [...document.querySelectorAll("[data-pointed]")].map((el) => el.id.replace("kifu-row-", ""));

  test("ポインタを動かして載せた行だけ", async () => {
    await mount();

    await moveTo(rowOf(1), 10, 20);
    expect(pointed()).toEqual(["1"]);

    await moveTo(commentButtonOf(2), 10, 60);
    expect(pointed()).toEqual(["2"]);
  });

  test("一覧の外へ動くと、無くなる", async () => {
    const { outside } = await mount();
    await moveTo(rowOf(1), 10, 20);

    await moveTo(outside, 300, 20);

    expect(pointed()).toEqual([]);
  });

  test("一覧から出ると、無くなる", async () => {
    const { list } = await mount();
    await moveTo(rowOf(1), 10, 20);

    await act(async () => {
      fireEvent.pointerLeave(list);
    });

    expect(pointed()).toEqual([]);
  });

  test("局面が動くと、次に動かすまで無くなる", async () => {
    const { goTo } = await mount();
    await moveTo(rowOf(1), 10, 20);

    await goTo(2);
    expect(pointed()).toEqual([]);

    await moveTo(rowOf(1), 11, 20);
    expect(pointed()).toEqual(["1"]);
  });

  test("一覧が流れると、次に動かすまで無くなる", async () => {
    const { list } = await mount();
    await moveTo(rowOf(1), 10, 20);

    await act(async () => {
      fireEvent.scroll(list);
    });
    expect(pointed()).toEqual([]);

    await moveTo(rowOf(3), 10, 21);
    expect(pointed()).toEqual(["3"]);
  });

  // WebKit は、止まったポインタの下で描き直しただけでも pointermove を送る
  test("座標が変わらない pointermove では、付かない", async () => {
    const { goTo } = await mount();
    await moveTo(rowOf(1), 10, 20);

    await goTo(2);
    await moveTo(rowOf(3), 10, 20);

    expect(pointed()).toEqual([]);
  });

  test("重なっていたものの上で止まり、それが消えても、付かない", async () => {
    const { outside } = await mount();
    await moveTo(rowOf(1), 10, 20);
    await moveTo(outside, 300, 400);

    await moveTo(rowOf(3), 300, 400);

    expect(pointed()).toEqual([]);
  });

  test("一覧が外れたら、もう見ない", async () => {
    await mount();
    cleanup();
    document.body.innerHTML = '<div class="kifu-row" id="kifu-row-9"></div>';

    await moveTo(rowOf(9), 10, 20);

    expect(pointed()).toEqual([]);
    document.body.innerHTML = "";
  });

  // 保存のたびにカーソルは作り直されるが、局面は動いていない
  test("コメントを保存しても、無くならない", async () => {
    const { saveComment } = await mount();
    await moveTo(rowOf(1), 10, 20);

    await saveComment(1, "角道を開ける");

    expect(pointed()).toEqual(["1"]);
  });
});

describe("メニューが開いている間", () => {
  test("分岐メニューが開いていれば、矢印で局面を動かさない", async () => {
    const { goTo, press, tesuu } = await mount();
    await goTo(2);
    await focus(forkButtonOf(2));
    await act(async () => {
      fireEvent.click(forkButtonOf(2));
    });

    await press("ArrowDown");

    expect(tesuu()).toBe(2);
    expect(document.activeElement).toBe(forkButtonOf(2));
  });
});
