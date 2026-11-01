import { describe, expect, test } from "vitest";
import { JKFPlayer } from "json-kifu-format";
import { buildPreviewData } from "../buildPreviewData";
import { buildPreviewDataFromSfen } from "../buildPreviewDataFromSfen";

/**
 * 棋譜の再生位置と SFEN のどちらからでも、プレビューは同じ形に組む。
 *
 * 持ち駒の並びは `shogi.js` が持っている順のままで、種類の順へ揃えるのは `HandRow` の仕事。
 */

const SFEN_WITH_HANDS = "4k4/9/9/9/9/9/9/9/4K4 w 2Pr 7";

function playerAfterExchange(): JKFPlayer {
  const player = JKFPlayer.parseCSA(
    ["V2.2", "PI", "+", "+7776FU", "-3334FU", "+8822UM", "-3122GI", ""].join("\n"),
  );
  player.goto(3);
  return player;
}

describe("buildPreviewData", () => {
  test("再生器のいまの局面を写す", () => {
    const player = playerAfterExchange();
    const preview = buildPreviewData(player, "node-3");

    expect(preview.nodeId).toBe("node-3");
    expect(preview.tesuu).toBe(3);
    expect(preview.turn).toBe(1);
    expect(preview.board).toBe(player.shogi.board);
    expect(preview.hands).toEqual({ 0: ["KA"], 1: [] });
  });

  test("再生器の持ち駒を後手の欄にも分けて写す", () => {
    const player = playerAfterExchange();
    player.goto(4);
    expect(buildPreviewData(player, "node-4").hands).toEqual({ 0: ["KA"], 1: ["KA"] });
  });
});

describe("buildPreviewDataFromSfen", () => {
  test("手番と持ち駒を読み、手数は0で固定の印を付ける", () => {
    const preview = buildPreviewDataFromSfen(SFEN_WITH_HANDS);

    expect(preview?.nodeId).toBe("sfen-preview");
    expect(preview?.tesuu).toBe(0);
    expect(preview?.turn).toBe(1);
    expect(preview?.hands).toEqual({ 0: ["FU", "FU"], 1: ["HI"] });
  });
});
