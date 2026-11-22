// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { Color } from "shogi.js";

import { useHeaderCenterInfo, type HeaderCenterInfo } from "../useHeaderCenterInfo";
import { GameProvider, useGame } from "@/entities/game";
import type { GameContextType } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";

/**
 * 見出しの題に出す1行（対局者・手番・手数）と、ファイル名。盤の手番と手数をそのまま言うこと。
 *
 * 食い違うと、利用者は盤の局面とは別の手番で次の手を考える。
 */
function mount() {
  const seen: { info: HeaderCenterInfo | null; game: GameContextType | null } = {
    info: null,
    game: null,
  };

  function Probe() {
    seen.game = useGame();
    seen.info = useHeaderCenterInfo();
    return null;
  }

  render(
    <GameProvider>
      <Probe />
    </GameProvider>,
  );

  return seen;
}

/** 本線2手の棋譜 */
const TWO_MOVES: JKFData = {
  header: { 先手: "先手A" },
  moves: [
    {},
    { move: { from: { x: 7, y: 7 }, to: { x: 7, y: 6 }, piece: "FU", color: Color.Black } },
    { move: { from: { x: 3, y: 3 }, to: { x: 3, y: 4 }, piece: "FU", color: Color.White } },
  ],
};

const NO_PLAYERS: JKFData = { header: {}, moves: [{}] };

async function loaded(jkf: JKFData, path = "/ws/研究/a.b.kif") {
  const seen = mount();
  await act(async () => {
    expect((await seen.game!.loadGame(jkf, path)).success).toBe(true);
  });
  return seen;
}

describe("見出しの題", () => {
  test("1手進めると後手番の1手目になる", async () => {
    const seen = await loaded(TWO_MOVES);

    act(() => seen.game!.nextMove());

    expect(seen.info!.tooltip).toBe("a.b — 先手 先手A / 後手 （不明） — 後手番 1/2");
  });

  test("見出しは拡張子を落としたファイル名で、題にはパスを出す", async () => {
    const seen = await loaded(TWO_MOVES);

    expect(seen.info!.fileLabel).toBe("a.b");
    expect(seen.info!.fileTitle).toBe("/ws/研究/a.b.kif");
  });

  test("拡張子の無い隠しファイルは、名前を落とさない", async () => {
    const seen = await loaded(TWO_MOVES, "/ws/.kif");

    expect(seen.info!.fileLabel).toBe(".kif");
  });

  test("パスの無い棋譜は「棋譜」と出す", async () => {
    const seen = await loaded(TWO_MOVES, "");

    expect(seen.info!.fileLabel).toBe("棋譜");
  });

  test("片方の対局者しか無くても対局者を出し、欠けた側は不明と添える", async () => {
    const seen = await loaded(TWO_MOVES);

    expect(seen.info!.tooltip).toBe("a.b — 先手 先手A / 後手 （不明） — 先手番 0/2");
  });

  test("対局者が居なければ対局者を出さない", async () => {
    const seen = await loaded(NO_PLAYERS);

    expect(seen.info!.tooltip).toBe("a.b — 棋譜表示中 — 先手番 0/0");
  });

  test("何も載っていなければ手数を出さない", () => {
    const seen = mount();

    expect(seen.info!.hasKifu).toBe(false);
    expect(seen.info!.tooltip).toBe("ファイル未選択");
  });
});
