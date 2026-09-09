// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { GameProvider } from "../provider";
import { useGame, useLoadedKifuPath } from "../useGame";
import type { GameContextType } from "../types";
import type { JKFData } from "@/entities/kifu/model/jkf";

/**
 * **細い context を分けている意味を固定する。**
 *
 * `useGame()` の value は `state` と `view` から作られるので、カーソルが1手動くたびに
 * 同一性が変わり、購読している部品が全員描き直される。ツリーの行のように数が多くて
 * 載っている棋譜しか要らない部品がそこに混ざると、盤を操作するだけで無関係な行が
 * 全部描き直される（ツリーは仮想化されていない）。
 *
 * ここが赤くなったら、`LoadedKifuPathContext` の value に `state` 由来の
 * オブジェクトが混ざっていないかを見ること。
 */

const JKF: JKFData = { header: {}, moves: [{}, { comments: ["t1"] }, { comments: ["t2"] }] };

function mount() {
  const seen = { game: null as GameContextType | null, narrow: 0, wide: 0 };

  function NarrowProbe() {
    useLoadedKifuPath();
    seen.narrow += 1;
    return null;
  }

  function WideProbe() {
    const game = useGame();
    useEffect(() => {
      seen.game = game;
    });
    seen.game = game;
    seen.wide += 1;
    return null;
  }

  render(
    <GameProvider>
      <NarrowProbe />
      <WideProbe />
    </GameProvider>,
  );

  return seen;
}

describe("盤に載っている棋譜のパスだけを配る context", () => {
  test("カーソルが動いても、細いほうは描き直さない", async () => {
    const seen = mount();

    await act(async () => {
      expect((await seen.game!.loadGame(JKF, "/ws/a.kif")).success).toBe(true);
    });

    const narrowAfterLoad = seen.narrow;
    const wideAfterLoad = seen.wide;

    await act(async () => {
      seen.game!.nextMove();
    });

    // 広いほうは動く。**動かないなら、この test は別の理由で通っている**
    expect(seen.wide).toBeGreaterThan(wideAfterLoad);
    expect(seen.narrow).toBe(narrowAfterLoad);
  });

  test("棋譜を載せ替えたときは描き直す", async () => {
    const seen = mount();

    await act(async () => {
      expect((await seen.game!.loadGame(JKF, "/ws/a.kif")).success).toBe(true);
    });
    const narrowAfterLoad = seen.narrow;

    await act(async () => {
      expect((await seen.game!.loadGame(JKF, "/ws/b.kif")).success).toBe(true);
    });

    expect(seen.narrow).toBeGreaterThan(narrowAfterLoad);
  });

  test("provider の外で呼ぶと投げる", () => {
    function Orphan() {
      useLoadedKifuPath();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(/GameProvider/);
  });
});
