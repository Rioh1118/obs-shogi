import type { JKFMove, JKFMoveMove, JKFState, ShogiMove } from "@/types";
import type { ISettingType, Kind } from "shogi.js";

// HandSummaryがエクスポートされていないので自分で定義
type HandSummary = {
  [K in Extract<Kind, "FU" | "KY" | "KE" | "GI" | "KI" | "KA" | "HI">]: number;
};

export function convertJKFStateToShogiSetting(
  jkfState: JKFState,
): ISettingType {
  // JKFStateからISettingType.dataに変換
  const board = jkfState.board.map((row) =>
    row.map((piece) => ({
      color: piece?.color,
      kind: piece?.kind,
    })),
  );

  // IHandFormatからHandSummaryに変換
  const hands: HandSummary[] = jkfState.hands.map((hand) => ({
    FU: hand.FU || 0,
    KY: hand.KY || 0,
    KE: hand.KE || 0,
    GI: hand.GI || 0,
    KI: hand.KI || 0,
    KA: hand.KA || 0,
    HI: hand.HI || 0,
  }));

  return {
    preset: "OTHER",
    data: {
      color: jkfState.color,
      board,
      hands,
    },
  };
}

// IMoveFormatからIMoveに変換
export function convertIMoveFormatToIMove(jkfMove: JKFMove): ShogiMove | null {
  try {
    // moveプロパティが存在しない場合はnull
    if (!jkfMove.move) {
      return null;
    }

    const moveData: JKFMoveMove = jkfMove.move;

    // toは必須
    if (!moveData.to) {
      return null;
    }

    const move: ShogiMove = {
      to: {
        x: moveData.to.x,
        y: moveData.to.y,
      },
    };

    // fromがある場合（移動）
    if (moveData.from) {
      move.from = {
        x: moveData.from.x,
        y: moveData.from.y,
      };
    }

    // 駒の種類
    if (moveData.piece) {
      move.kind = moveData.piece;
    }

    // 色
    if (moveData.color) {
      move.color = moveData.color;
    }

    return move;
  } catch (error) {
    console.warn("Failed to convert IMoveFormat to IMove:", error);
    return null;
  }
}
