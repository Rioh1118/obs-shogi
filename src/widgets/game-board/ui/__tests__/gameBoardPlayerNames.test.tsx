// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router";

import GameBoard from "../GameBoard";
import { GameProvider, useGame } from "@/entities/game";
import type { GameContextType } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";

/**
 * 盤の対局者名の出どころを固定する。
 *
 * **ツリーを混ぜないこと自体が仕様。** ここが `useFileTree` を読むようになると、
 * 駒の並びと対局者名が別の棋譜になる（#434）。`GameProvider` しか置いていないので、
 * ツリーを読み直した瞬間に落ちる。
 */
function mount() {
  const seen: { game: GameContextType | null } = { game: null };

  function Probe() {
    const game = useGame();
    useEffect(() => {
      seen.game = game;
    });
    seen.game = game;
    return null;
  }

  const view = render(
    <MemoryRouter initialEntries={["/app"]}>
      <GameProvider>
        <Probe />
        <GameBoard topLeft={null} center={null} bottomRight={null} />
      </GameProvider>
    </MemoryRouter>,
  );

  return { seen, view };
}

const names = (container: HTMLElement) =>
  [...container.querySelectorAll(".hand-header__name")].map((n) => n.textContent);

const OK: JKFData = { header: { 先手: "先手A", 後手: "後手A" }, moves: [{}] };

/** `game.md` の E16。`preset: "OTHER"` で `initial.data.board` が無い */
const UNLOADABLE = {
  header: { 先手: "先手B", 後手: "後手B" },
  initial: { preset: "OTHER" },
  moves: [{}],
} as unknown as JKFData;

describe("盤の対局者名の出どころ", () => {
  test("載っている棋譜の対局者名を出す", async () => {
    const { seen, view } = mount();

    await act(async () => {
      expect((await seen.game!.loadGame(OK, "/ws/a.kif")).success).toBe(true);
    });

    expect(names(view.container)).toEqual(["後手A", "先手A"]);
  });

  /**
   * **盤に載せられない棋譜を開いても、対局者名は前の棋譜のまま**（`failure-surfacing.md` の F-31）。
   *
   * 出どころを `useFileTree` の `jkfData` に戻すと、ここだけが `先手B` / `後手B` に
   * 動き、駒は `a.kif` のまま残る。
   */
  test("盤に載せられない棋譜を開いても、対局者名は前の棋譜のまま", async () => {
    const { seen, view } = mount();

    await act(async () => {
      expect((await seen.game!.loadGame(OK, "/ws/a.kif")).success).toBe(true);
    });
    await act(async () => {
      expect((await seen.game!.loadGame(UNLOADABLE, "/ws/b.kif")).success).toBe(false);
    });

    expect(names(view.container)).toEqual(["後手A", "先手A"]);
  });
});
