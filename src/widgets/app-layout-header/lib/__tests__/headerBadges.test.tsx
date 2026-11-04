// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { act, render } from "@testing-library/react";
import { Color } from "shogi.js";

import { useHeaderCenterInfo, type HeaderCenterInfo } from "../useHeaderCenterInfo";
import { turnGlyph } from "@/shared/lib/turn";
import { GameProvider, useGame } from "@/entities/game";
import type { GameContextType } from "@/entities/game";
import type { JKFData } from "@/entities/kifu/model/jkf";

/**
 * ヘッダの手番と手数の表示。盤の手番と手数をそのまま言うこと。
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

describe("ヘッダの手番と手数", () => {
  test("開いた直後は先手番の0手目で、終端の手数を添える", async () => {
    const seen = await loaded(TWO_MOVES);

    expect(seen.info!.turnText).toBe("先手番");
    expect(seen.info!.turnGlyph).toBe(turnGlyph(Color.Black));
    expect(seen.info!.tesuuText).toBe("0手目");
    expect(seen.info!.totalText).toBe("0/2");
  });

  test("1手進めると後手番の1手目になる", async () => {
    const seen = await loaded(TWO_MOVES);

    act(() => seen.game!.nextMove());

    expect(seen.info!.turnText).toBe("後手番");
    expect(seen.info!.turnGlyph).toBe(turnGlyph(Color.White));
    expect(seen.info!.tesuuText).toBe("1手目");
    expect(seen.info!.totalText).toBe("1/2");
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

    expect(seen.info!.isPlayersShown).toBe(true);
    expect(seen.info!.goteName).toBeNull();
    expect(seen.info!.tooltip).toBe("a.b — 先手 先手A / 後手 （不明） — 先手番 0/2");
  });

  test("対局者が居なければ対局者を出さない", async () => {
    const seen = await loaded(NO_PLAYERS);

    expect(seen.info!.isPlayersShown).toBe(false);
    expect(seen.info!.tooltip).toBe("a.b — 棋譜表示中 — 先手番 0/0");
  });

  test("何も載っていなければ手数を出さない", () => {
    const seen = mount();

    expect(seen.info!.tesuuText).toBe("");
    expect(seen.info!.totalText).toBe("");
    expect(seen.info!.isPlayersShown).toBe(false);
    expect(seen.info!.tooltip).toBe("ファイル未選択");
  });
});
