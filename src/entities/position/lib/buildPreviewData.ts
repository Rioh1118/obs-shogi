import type { Color, Shogi } from "shogi.js";
import type { JKFPlayer } from "json-kifu-format";
import type { PreviewData } from "@/entities/position/model/preview";

export function previewFromShogi(shogi: Shogi, tesuu: number, nodeId: string): PreviewData {
  const handKinds = (color: Color) => shogi.hands[color].map((piece) => piece.kind);

  return {
    board: shogi.board,
    hands: { 0: handKinds(0), 1: handKinds(1) },
    tesuu,
    turn: shogi.turn,
    nodeId,
  };
}

export function buildPreviewData(player: JKFPlayer, nodeId: string): PreviewData {
  return previewFromShogi(player.shogi, player.tesuu, nodeId);
}
