// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { GameProvider } from "../provider";
import { useGame } from "../useGame";
import type { GameContextType, GamePersistence, MoveGate } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";
import { Ok } from "@/shared/lib/result";

/**
 * 盤の着手が、積む前に門を通ること。
 *
 * **門の中身はここで見ない**（それは `features/game-move` の仕事）。
 * ここが守るのは「**盤が門を通る**」の1点で、これが外れると対局中でも
 * 相手の手番で積めてしまい、Rust の写しと食い違った指し手列で裁定を返すことになる。
 */

/** 盤は保存先が無いと指せない。**この試験の主題ではないので、書けたことにする** */
const PERSISTENCE: GamePersistence = {
  absPath: "/w/a.kif",
  save: async () => Ok(undefined),
};

function mountGame(moveGate?: MoveGate) {
  const seen: { current: GameContextType | null } = { current: null };

  function Probe() {
    const game = useGame();
    useEffect(() => {
      seen.current = game;
    });
    seen.current = game;
    return null;
  }

  render(
    <GameProvider persistence={PERSISTENCE} moveGate={moveGate}>
      <Probe />
    </GameProvider>,
  );

  return seen;
}

/** 平手の空の棋譜 */
const EMPTY: JKFData = { header: {}, moves: [{}] };

afterEach(() => {
  cleanup();
});

/** 7七の歩を選んで7六へ動かす */
async function playPawn(game: { current: GameContextType | null }) {
  await act(async () => {
    await game.current!.selectSquare(7, 7);
  });
  await act(async () => {
    await game.current!.selectSquare(7, 6);
  });
}

describe("盤の着手と門", () => {
  test("門が通せば、いつもどおり積む", async () => {
    const accept = vi.fn(async () => true);
    const game = mountGame({ accept });

    await act(async () => {
      await game.current!.loadGame(EMPTY, "/w/a.kif");
    });
    await playPawn(game);

    expect(accept).toHaveBeenCalledTimes(1);
    expect(game.current!.state.cursor?.tesuu).toBe(1);
  });

  /** **積まないことがこの門の仕事。** 通してしまうと対局が壊れる */
  test("門が断れば、棋譜は動かない", async () => {
    const accept = vi.fn(async () => false);
    const game = mountGame({ accept });

    await act(async () => {
      await game.current!.loadGame(EMPTY, "/w/a.kif");
    });
    await playPawn(game);

    expect(accept).toHaveBeenCalledTimes(1);
    expect(game.current!.state.cursor?.tesuu).toBe(0);
    // 選択も解いておく（残すと、押せない升が選ばれたままになる）
    expect(game.current!.state.selectedPosition).toBeNull();
  });

  test("門に、いま盤に載っている棋譜を渡す", async () => {
    const accept = vi.fn(async () => true);
    const game = mountGame({ accept });

    await act(async () => {
      await game.current!.loadGame(EMPTY, "/w/a.kif");
    });
    await playPawn(game);

    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ to: { x: 7, y: 6 } }),
      "/w/a.kif",
    );
  });

  /** **門を渡さない呼び手は素通し。** 盤だけを立てる場所に対局を持ち込まない */
  test("門が無ければ、そのまま積む", async () => {
    const game = mountGame();

    await act(async () => {
      await game.current!.loadGame(EMPTY, "/w/a.kif");
    });
    await playPawn(game);

    expect(game.current!.state.cursor?.tesuu).toBe(1);
  });
});
