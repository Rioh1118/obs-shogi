import { Shogi } from "shogi.js";
import type { PreviewData } from "@/entities/position/model/preview";
import { stateFromSfen } from "./positionDraft";

/**
 * SFEN 文字列から PreviewData を構築する。
 * JKFPlayer を経由せず、shogi.js の Shogi クラスで盤面を直接復元する。
 *
 * **綴りを先に見る。** `initializeFromSFENString` は持ち駒の枚数に線形で、
 * `4000000P`（7桁）で 604ms、1桁増えるごとに10倍かかる。桁数を制限する綴りが
 * ライブラリ側に無いので、投げるまで待つと**画面がその間止まる**。
 * SFEN の出どころ（`study_positions.json`・URL の `sfen=`）はどちらも
 * 検査を通っていないので、ここに門が要る。
 */
export function buildPreviewDataFromSfen(sfen: string): PreviewData | null {
  if (!stateFromSfen(sfen)) return null;

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
