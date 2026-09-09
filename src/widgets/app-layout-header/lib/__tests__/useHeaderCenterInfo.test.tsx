// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect } from "react";

import { useHeaderCenterInfo, type HeaderCenterInfo } from "../useHeaderCenterInfo";
import { GameProvider, useGame } from "@/entities/game";
import type { GameContextType } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";

/**
 * ヘッダの出どころを固定する。
 *
 * **ツリーを混ぜないこと自体が仕様。** ここが `useFileTree` を読むようになると、
 * 盤に載せられなかった棋譜でも見出しだけが入れ替わる（#434）。この test は
 * `GameProvider` しか置いていないので、ツリーを読み直した瞬間に落ちる。
 */
function mount() {
  const seen: { info: HeaderCenterInfo | null; game: GameContextType | null } = {
    info: null,
    game: null,
  };

  function Probe() {
    const game = useGame();
    const info = useHeaderCenterInfo();
    useEffect(() => {
      seen.game = game;
      seen.info = info;
    });
    seen.game = game;
    seen.info = info;
    return null;
  }

  render(
    <GameProvider>
      <Probe />
    </GameProvider>,
  );

  return seen;
}

const OK: JKFData = { header: { 先手: "先手A", 後手: "後手A" }, moves: [{}] };

/** `game.md` の E16。`preset: "OTHER"` で `initial.data.board` が無い */
const UNLOADABLE = {
  header: { 先手: "先手B", 後手: "後手B" },
  initial: { preset: "OTHER" },
  moves: [{}],
} as unknown as JKFData;

describe("ヘッダ中央の出どころ", () => {
  test("載っている棋譜のパスと対局者名を出す", async () => {
    const seen = mount();

    await act(async () => {
      expect((await seen.game!.loadGame(OK, "/ws/a.kif")).success).toBe(true);
    });

    expect(seen.info!.fileLabel).toBe("a");
    expect(seen.info!.fileTitle).toBe("/ws/a.kif");
    expect(seen.info!.senteName).toBe("先手A");
  });

  /**
   * **盤に載せられない棋譜を開いても、見出しは前の棋譜のまま**（`failure-surfacing.md` の F-31）。
   *
   * 出どころを `useFileTree` の `selectedNode` / `jkfData` に戻すと、ここだけが
   * `b` と `先手B` に動き、盤と棋譜一覧は `a.kif` のまま残る。
   */
  test("盤に載せられない棋譜を開いても、見出しは前の棋譜のまま", async () => {
    const seen = mount();

    await act(async () => {
      expect((await seen.game!.loadGame(OK, "/ws/a.kif")).success).toBe(true);
    });
    await act(async () => {
      expect((await seen.game!.loadGame(UNLOADABLE, "/ws/b.kif")).success).toBe(false);
    });

    expect(seen.info!.fileLabel).toBe("a");
    expect(seen.info!.fileTitle).toBe("/ws/a.kif");
    expect(seen.info!.senteName).toBe("先手A");
    expect(seen.info!.goteName).toBe("後手A");
  });

  test("何も載っていなければ「ファイル未選択」", () => {
    const seen = mount();

    expect(seen.info!.hasKifu).toBe(false);
    expect(seen.info!.fileLabel).toBe("ファイル未選択");
    expect(seen.info!.fileTitle).toBe("ファイル未選択");
  });
});
