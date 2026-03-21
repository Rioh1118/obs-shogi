import { Shogi } from "shogi.js";
import type { PreviewData } from "@/entities/position/model/preview";

/**
 * SFEN 文字列から PreviewData を構築する。
 * JKFPlayer を経由せず、shogi.js の Shogi クラスで盤面を直接復元する。
 */
export function buildPreviewDataFromSfen(sfen: string): PreviewData | null {
  try {
    const shogi = new Shogi();
    shogi.initializeFromSFENString(sfen);

    const toKindList = (color: 0 | 1): string[] => {
      const pieces = shogi.hands?.[color] ?? [];
      return pieces.flatMap((p) => (p?.kind ? [p.kind] : []));
    };

    return {
      board: shogi.board,
      hands: {
        0: toKindList(0),
        1: toKindList(1),
      },
      tesuu: 0,
      turn: shogi.turn as 0 | 1,
      nodeId: "sfen-preview",
    };
  } catch (e) {
    console.warn("[buildPreviewDataFromSfen] failed:", e, sfen);
    return null;
  }
}
