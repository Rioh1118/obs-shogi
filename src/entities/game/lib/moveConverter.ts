import type { Color, IMove, Kind } from "shogi.js";
import type { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { ShogiMove, StandardMoveFormat } from "../model/types";

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
export function toIMoveMoveFormat(move: StandardMoveFormat): IMoveMoveFormat {
  return {
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: move.color,
    ...(move.promote !== undefined ? { promote: move.promote } : {}),
  };
}

/**
 * 直前の手を、盤の着手表示が要る形にする。
 *
 * `to` を持たない手（投了・中断などの `special`）は指す升が無いので `null`。
 */
export function lastMoveHighlight(player: JKFPlayer): ShogiMove | null {
  if (player.tesuu === 0) return null;
  const move = player.getMove();
  if (!move || !move.to) return null;
  return { from: move.from, to: move.to, kind: move.piece, color: move.color };
}
