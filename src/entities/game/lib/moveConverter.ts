import type { Color, IMove, Kind } from "shogi.js";
import type { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { StandardMoveFormat } from "@/entities/game/model/types";

export function fromIMove(
  move: IMove,
  piece: Kind,
  color: Color,
  promote?: boolean,
): StandardMoveFormat {
  return {
    from: move.from,
    to: move.to,
    piece: move.kind ?? piece,
    promote,
    color: move.color ?? color,
  };
}

// StandardMoveFormat から IMoveMoveFormat への変換
export function toIMoveMoveFormat(standardMove: StandardMoveFormat): IMoveMoveFormat {
  return {
    from: standardMove.from,
    to: standardMove.to,
    piece: standardMove.piece,
    color: standardMove.color,
    ...(standardMove.promote !== undefined ? { promote: standardMove.promote } : {}),
  };
}

/**
 * 直前の手を、盤の着手表示が要る形にする。
 *
 * `to` を持たない手（投了・中断などの `special`）は指す升が無いので `null`。
 */
export function lastMoveHighlight(player: JKFPlayer) {
  if (player.tesuu === 0) return null;
  const mv = player.getMove();
  if (!mv || !mv.to) return null;
  return { from: mv.from, to: mv.to, kind: mv.piece, color: mv.color };
}
