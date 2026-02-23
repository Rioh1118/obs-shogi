import type { Color, IMove, Kind } from "shogi.js";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { StandardMoveFormat } from "@/entities/game";

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
export function toIMoveMoveFormat(
  standardMove: StandardMoveFormat,
): IMoveMoveFormat {
  return {
    from: standardMove.from,
    to: standardMove.to,
    piece: standardMove.piece,
    color: standardMove.color,
    ...(standardMove.promote === true ? { promote: true } : {}),
  };
}
