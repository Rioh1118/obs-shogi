import type { PreviewData } from "@/entities/position/model/preview";
import type { JKFPlayer } from "json-kifu-format";

export function buildPreviewData(jkf: JKFPlayer, nodeId: string): PreviewData {
  const shogi = jkf.shogi;

  const toKindList = (color: 0 | 1): string[] => {
    const pieces = shogi.hands?.[color] ?? [];
    return pieces.map((p) => p?.kind);
  };

  return {
    board: shogi.board,
    hands: {
      0: toKindList(0),
      1: toKindList(1),
    },
    tesuu: jkf.tesuu,
    turn: shogi.turn,
    nodeId,
  };
}
