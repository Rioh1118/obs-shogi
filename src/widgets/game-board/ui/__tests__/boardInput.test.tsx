// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Color } from "shogi.js";

import { GameProvider, useGame, type GameContextType } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { Err, Ok } from "@/shared/lib/result";
import Board from "../Board";
import GameControls from "../GameControls";
import Hand from "../Hand";

/**
 * 盤、駒台、手送りの押下が、棋譜の何を動かすか。
 *
 * 盤の押下は選択か着手になり、着手はそのまま棋譜ファイルへ書かれる。
 * 駒台は手番の側だけが持ち駒を選べる。取り違えると、選べない駒が選べるか、
 * 選んだ駒と違う駒が打たれる。成りの選択肢そのものは `boardPromotion.test.tsx` が見る。
 */

type PieceAt = { x: number; y: number; color: Color; kind: string };

/** 2つの玉と先手の歩3枚。駒台は先手が歩2枚と金、後手が角。手番は先手 */
const POSITION: JKFData = jkfOf(
  [
    { x: 9, y: 1, color: Color.White, kind: "OU" },
    { x: 9, y: 9, color: Color.Black, kind: "OU" },
    { x: 3, y: 4, color: Color.Black, kind: "FU" },
    { x: 5, y: 7, color: Color.Black, kind: "FU" },
  ],
  [{ FU: 2, KI: 1 }, { KA: 1 }],
  [{}, { move: { from: { x: 5, y: 7 }, to: { x: 5, y: 6 }, color: Color.Black, piece: "FU" } }],
);

function jkfOf(
  pieces: PieceAt[],
  hands: [Record<string, number>, Record<string, number>],
  moves: unknown[],
): JKFData {
  const board: { color?: Color; kind?: string }[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => ({})),
  );
  for (const { x, y, color, kind } of pieces) board[x - 1][y - 1] = { color, kind };
  return {
    header: {},
    initial: { preset: "OTHER", data: { color: Color.Black, board, hands } },
    moves,
  } as unknown as JKFData;
}

/** 後手の歩が3六に居る局面。手番は後手で、3七へ進めると成れる */
const GOTE_TO_PROMOTE: JKFData = jkfOf(
  [
    { x: 9, y: 1, color: Color.White, kind: "OU" },
    { x: 9, y: 9, color: Color.Black, kind: "OU" },
    { x: 3, y: 6, color: Color.White, kind: "FU" },
  ],
  [{}, {}],
  [{}],
);
(GOTE_TO_PROMOTE.initial as { data: { color: Color } }).data.color = Color.White;

type MountOptions = {
  position?: JKFData;
  /** 棋譜ファイルへの書き込みが落ちるか */
  saveFails?: boolean;
};

async function mount({ position = POSITION, saveFails = false }: MountOptions = {}) {
  const game: { current: GameContextType | null } = { current: null };

  function Probe() {
    game.current = useGame();
    return <></>;
  }

  const { container } = render(
    <GameProvider
      persistence={{
        absPath: "/w/a.kif",
        save: async () => (saveFails ? Err("disk full") : Ok(undefined)),
      }}
    >
      <Probe />
      <Hand isSente={false} />
      <Board />
      <Hand isSente={true} />
      <GameControls />
    </GameProvider>,
  );
  await act(async () => {
    expect((await game.current!.loadGame(position, "/w/a.kif")).success).toBe(true);
  });

  const square = (x: number, y: number) =>
    container.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)!;

  async function run(action: () => void) {
    await act(async () => {
      action();
    });
  }

  return {
    game,
    container,
    square,
    pressSquare: (x: number, y: number) => run(() => fireEvent.click(square(x, y))),
    press: (element: Element) => run(() => fireEvent.click(element)),
    pointerDown: (element: Element) => run(() => fireEvent.pointerDown(element)),
    run,
  };
}

const senteHand = (container: HTMLElement) => container.querySelector(".player-hand")!;
const goteHand = (container: HTMLElement) => container.querySelector(".opponent-hand")!;
const piecesIn = (hand: Element, alt: string) => [
  ...hand.querySelectorAll<HTMLImageElement>(`img[alt="${alt}"]`),
];

afterEach(cleanup);

describe("盤の押下", () => {
  test("手番の駒を押すと選び、行ける升と選んだ升に印が付く", async () => {
    const { game, container, square, pressSquare } = await mount();

    await pressSquare(3, 4);

    expect(game.current!.state.selectedPosition).toEqual({ type: "square", x: 3, y: 4 });
    expect(square(3, 4).classList.contains("square--selected")).toBe(true);
    expect(square(3, 3).classList.contains("square__highlighted")).toBe(true);
    expect(container.querySelectorAll(".square__highlighted")).toHaveLength(1);
    expect(container.querySelectorAll(".square--selected")).toHaveLength(1);
  });

  test("選んだ駒をもう一度押すと選択が外れる", async () => {
    const { game, pressSquare } = await mount();

    await pressSquare(3, 4);
    await pressSquare(3, 4);

    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("選んだまま行けない升を押すと、その升を選び直す", async () => {
    const { game, pressSquare } = await mount();

    await pressSquare(3, 4);
    await pressSquare(5, 7);

    expect(game.current!.state.selectedPosition).toEqual({ type: "square", x: 5, y: 7 });
    expect(game.current!.state.cursor?.tesuu).toBe(0);
  });

  test("行ける升を押すと指し、指した升に直前の手の印が付く", async () => {
    const { game, container, square, pressSquare } = await mount();

    await pressSquare(5, 7);
    await pressSquare(5, 6);

    expect(game.current!.view.currentMove).toMatchObject({
      from: { x: 5, y: 7 },
      to: { x: 5, y: 6 },
    });
    expect(square(5, 6).classList.contains("square__last-move")).toBe(true);
    expect(container.querySelectorAll(".square__last-move")).toHaveLength(1);
  });

  test("成りを聞いている間は、盤を押しても選択も局面も動かない", async () => {
    const { game, pressSquare } = await mount();

    await pressSquare(3, 4);
    await pressSquare(3, 3);
    await pressSquare(5, 7);

    expect(game.current!.state.selectedPosition).toEqual({ type: "square", x: 3, y: 4 });
    expect(game.current!.state.cursor?.tesuu).toBe(0);
    expect(screen.getByAltText("と")).toBeTruthy();
  });

  test("成りを聞いている間に局面が動いたら、選択肢と選択を畳む", async () => {
    const { game, pressSquare, run } = await mount();

    await pressSquare(3, 4);
    await pressSquare(3, 3);
    await run(() => game.current!.nextMove());

    expect(game.current!.state.cursor?.tesuu).toBe(1);
    expect(screen.queryByAltText("と")).toBeNull();
    expect(game.current!.state.selectedPosition).toBeNull();
  });
});

describe("成りの選択肢", () => {
  test("後手の手では、選択肢の駒を後手の向きで出す", async () => {
    const { container, pressSquare } = await mount({ position: GOTE_TO_PROMOTE });

    await pressSquare(3, 6);
    await pressSquare(3, 7);

    const choice = container.querySelector(".promotion-choice__white")!;
    expect(choice).not.toBeNull();
    const colors = [...choice.querySelectorAll("[data-piece]")].map((piece) =>
      piece.getAttribute("data-color"),
    );
    expect(colors).toEqual([String(Color.White), String(Color.White)]);
  });

  test("選んだ手が棋譜に書けずに戻っても、選択肢は畳む", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { game, press, pressSquare } = await mount({ saveFails: true });

    await pressSquare(3, 4);
    await pressSquare(3, 3);
    await press(screen.getByAltText("と"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(game.current!.state.cursor?.tesuu).toBe(0);
    expect(screen.queryByAltText("と")).toBeNull();
    error.mockRestore();
  });
});

describe("駒台の押下", () => {
  test("手番の駒台の駒を押すと、その種類の持ち駒を選ぶ", async () => {
    const { game, container, press } = await mount();

    await press(piecesIn(senteHand(container), "金")[0]);

    expect(game.current!.state.selectedPosition).toEqual({
      type: "hand",
      color: Color.Black,
      kind: "KI",
    });
  });

  test("同じ種類が2枚あれば、印は押した1枚にだけ付く", async () => {
    const { game, container, press } = await mount();
    const pawns = piecesIn(senteHand(container), "歩");
    expect(pawns).toHaveLength(2);

    await press(pawns[1]);

    expect(game.current!.state.selectedPosition).toMatchObject({ type: "hand", kind: "FU" });
    expect(pawns[1].closest(".hand-piece")!.classList.contains("hand-piece--selected")).toBe(true);
    expect(container.querySelectorAll(".hand-piece--selected")).toHaveLength(1);
  });

  test("選んだ持ち駒をもう一度押すと選択が外れる", async () => {
    const { game, container, press } = await mount();
    const [gold] = piecesIn(senteHand(container), "金");

    await press(gold);
    await press(gold);

    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("同じ種類の別の1枚を押すと、選んだまま印だけが移る", async () => {
    const { game, container, press } = await mount();
    const pawns = piecesIn(senteHand(container), "歩");

    await press(pawns[0]);
    await press(pawns[1]);

    expect(game.current!.state.selectedPosition).toMatchObject({ type: "hand", kind: "FU" });
    expect(pawns[1].closest(".hand-piece")!.classList.contains("hand-piece--selected")).toBe(true);
    expect(container.querySelectorAll(".hand-piece--selected")).toHaveLength(1);
  });

  test("手番でない駒台の駒を押すと、選んでいたものを外すだけ", async () => {
    const { game, container, press, pressSquare } = await mount();

    await pressSquare(3, 4);
    await press(piecesIn(goteHand(container), "角")[0]);

    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("持ち駒を選んで升を押すと、その駒を打つ", async () => {
    const { game, container, press, pressSquare } = await mount();

    await press(piecesIn(senteHand(container), "金")[0]);
    await pressSquare(5, 5);

    expect(game.current!.view.currentMove).toMatchObject({ to: { x: 5, y: 5 }, piece: "KI" });
    expect(game.current!.view.currentMove?.from).toBeUndefined();
  });

  test("駒台の余白を押すと選択が外れ、駒の上を押しても外れない", async () => {
    const { game, container, press, pointerDown } = await mount();
    const [gold] = piecesIn(senteHand(container), "金");

    await press(gold);
    await pointerDown(gold);
    expect(game.current!.state.selectedPosition).toMatchObject({ type: "hand", kind: "KI" });

    await pointerDown(senteHand(container));
    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("駒の高さは幅の1.1倍", async () => {
    const { container } = await mount();
    const [gold] = piecesIn(senteHand(container), "金");
    const piece = gold.closest<HTMLElement>(".hand-piece")!;

    const width = parseFloat(piece.style.width);
    expect(parseFloat(piece.style.height)).toBeCloseTo(width * 1.1);
  });

  test("先手の駒台は上の段から、後手の駒台は下の段から並べる", async () => {
    const { container } = await mount();
    const rowsOf = (hand: Element) =>
      [...hand.querySelectorAll(".hand-row")].map((row) =>
        [...row.classList].find((name) => /^hand-row\d$/.test(name)),
      );

    expect(rowsOf(senteHand(container))).toEqual([
      "hand-row1",
      "hand-row2",
      "hand-row3",
      "hand-row4",
    ]);
    expect(rowsOf(goteHand(container))).toEqual([
      "hand-row4",
      "hand-row3",
      "hand-row2",
      "hand-row1",
    ]);
  });
});

describe("手送り", () => {
  test("最初の局面では戻れず、進むと最後の局面で進めなくなる", async () => {
    const { game, press } = await mount();
    const button = (title: string) => screen.getByTitle(title) as HTMLButtonElement;

    expect(button("最初に戻る").disabled).toBe(true);
    expect(button("前の手").disabled).toBe(true);

    await press(button("次の手"));
    expect(game.current!.state.cursor?.tesuu).toBe(1);
    expect(button("次の手").disabled).toBe(true);
    expect(button("最後に進む").disabled).toBe(true);

    await press(button("前の手"));
    expect(game.current!.state.cursor?.tesuu).toBe(0);

    await press(button("最後に進む"));
    expect(game.current!.state.cursor?.tesuu).toBe(1);

    await press(button("最初に戻る"));
    expect(game.current!.state.cursor?.tesuu).toBe(0);
  });
});
