import type { StandardMoveFormat } from "@/types";
import type { Color, IMove, Kind } from "shogi.js";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

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
    promote: standardMove.promote,
    color: standardMove.color,
    // capture, relative, same等はRust側で正規化される
  };
}
