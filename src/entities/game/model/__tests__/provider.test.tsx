// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { GameProvider } from "../provider";
import { useGame } from "../useGame";
import type { GameContextType } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";

/** provider の外へ context を取り出す。操作は `act` で包んで呼ぶ */
function mountGame() {
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
    <GameProvider>
      <Probe />
    </GameProvider>,
  );

  return seen;
}

describe("loadGame", () => {
  test("読み込めた棋譜は state に入り、カーソルは開始局面", async () => {
    const game = mountGame();
    const jkf: JKFData = { header: {}, moves: [{}, { comments: ["t1"] }] };

    await act(async () => {
      await game.current!.loadGame(jkf, "/ok.kif");
    });

    expect(game.current!.state.jkf).not.toBeNull();
    expect(game.current!.state.cursor?.tesuu).toBe(0);
    expect(game.current!.state.loadedAbsPath).toBe("/ok.kif");
    expect(game.current!.state.error).toBeNull();
  });

  /**
   * 盤に載せられない `initial` を持つ棋譜を弾く（`game.md` の E16）。
   *
   * これを見ているのは `loadGame` の `buildPlayer(nextJkf, ROOT_CURSOR)` **1行だけ**で、
   * 返り値を使わないので消しても tsc も lint も通る。消すと壊れた棋譜が
   * `state.jkf` に入り、`cursorView` の catch が `player: null` を返して
   * **盤も棋譜ペインも空・文言なし・`error` すら null** になる。
   */
  test("盤に載せられない棋譜は state に入れず、理由を error に残す", async () => {
    const game = mountGame();
    const broken = { header: {}, initial: { preset: "OTHER" }, moves: [{}] } as unknown as JKFData;

    await act(async () => {
      await game.current!.loadGame(broken, "/broken.kif");
    });

    expect(game.current!.state.jkf).toBeNull();
    expect(game.current!.state.error).not.toBeNull();
  });
});
