// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Color } from "shogi.js";

import { GameProvider, useGame, type GameContextType } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { Ok } from "@/shared/lib/result";
import Board from "../Board";

/**
 * 盤の押下から成りの扱いが決まるまで。
 *
 * 選択肢を出すかは `Board` が決め、`selectSquare` へ渡す成りの指定で棋譜の手が決まる。
 * 取り違えると、行き所のない不成が積まれるか、成れる手で選択肢が出なくなる。
 */

/** 先手の歩が3か所にある局面。2二は不成で行き所がなく、3四は成れて、5七は成れない */
const PAWNS: JKFData = {
  header: {},
  initial: {
    preset: "OTHER",
    data: {
      color: Color.Black,
      board: boardOf([
        { x: 9, y: 1, color: Color.White, kind: "OU" },
        { x: 9, y: 9, color: Color.Black, kind: "OU" },
        { x: 2, y: 2, color: Color.Black, kind: "FU" },
        { x: 3, y: 4, color: Color.Black, kind: "FU" },
        { x: 5, y: 7, color: Color.Black, kind: "FU" },
      ]),
      hands: [{}, {}],
    },
  },
  moves: [{}],
} as unknown as JKFData;

function boardOf(pieces: { x: number; y: number; color: Color; kind: string }[]) {
  const board: { color?: Color; kind?: string }[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => ({})),
  );
  for (const { x, y, color, kind } of pieces) board[x - 1][y - 1] = { color, kind };
  return board;
}

async function mountBoard() {
  const seen: { current: GameContextType | null } = { current: null };

  function Probe() {
    seen.current = useGame();
    return null;
  }

  const { container } = render(
    <GameProvider persistence={{ absPath: "/w/a.kif", save: async () => Ok(undefined) }}>
      <Probe />
      <Board />
    </GameProvider>,
  );
  await act(async () => {
    expect((await seen.current!.loadGame(PAWNS, "/w/a.kif")).success).toBe(true);
  });

  async function press(selector: string) {
    await act(async () => {
      fireEvent.click(container.querySelector(selector)!);
    });
  }

  return {
    game: seen,
    choice: () => container.querySelector(".promotion-choice"),
    press,
    pressSquare: (x: number, y: number) => press(`[data-x="${x}"][data-y="${y}"]`),
  };
}

afterEach(cleanup);

describe("盤の成り", () => {
  test("行き所がなくなる手は選択肢を出さずに成る", async () => {
    const { game, choice, pressSquare } = await mountBoard();

    await pressSquare(2, 2);
    await pressSquare(2, 1);

    expect(choice()).toBeNull();
    expect(game.current!.view.currentMove).toMatchObject({ to: { x: 2, y: 1 }, promote: true });
  });

  test("成れる手は選択肢を出し、成るを選ぶと成る", async () => {
    const { game, choice, press, pressSquare } = await mountBoard();

    await pressSquare(3, 4);
    await pressSquare(3, 3);
    expect(choice()).not.toBeNull();
    expect(game.current!.state.cursor?.tesuu).toBe(0);

    await press(".promotion-choice__piece--promote");

    expect(game.current!.view.currentMove).toMatchObject({ to: { x: 3, y: 3 }, promote: true });
  });

  test("成れる手で成らないを選ぶと不成で積む", async () => {
    const { game, press, pressSquare } = await mountBoard();

    await pressSquare(3, 4);
    await pressSquare(3, 3);
    await press(".promotion-choice__piece--not-promote");

    expect(game.current!.view.currentMove).toMatchObject({ to: { x: 3, y: 3 }, piece: "FU" });
    expect(game.current!.view.currentMove?.promote).toBeFalsy();
  });

  test("成れない手は選択肢を出さない", async () => {
    const { game, choice, pressSquare } = await mountBoard();

    await pressSquare(5, 7);
    await pressSquare(5, 6);

    expect(choice()).toBeNull();
    expect(game.current!.view.currentMove?.promote).toBeFalsy();
    expect(game.current!.state.cursor?.tesuu).toBe(1);
  });
});
