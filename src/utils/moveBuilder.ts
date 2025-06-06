import type { Color, Kind } from "@/types";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

export class MoveBuilder {
  static normalMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    piece: Kind,
    color: Color,
    promote?: boolean,
    capture?: Kind,
  ): IMoveMoveFormat {
    return {
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      piece,
      color,
      promote,
      capture,
    };
  }

  static dropMove(
    toX: number,
    toY: number,
    piece: Kind,
    color: Color,
  ): IMoveMoveFormat {
    return {
      to: { x: toX, y: toY },
      piece,
      color,
    };
  }

  static withPromotion(
    move: IMoveMoveFormat,
    promote: boolean,
  ): IMoveMoveFormat {
    return { ...move, promote };
  }
}
