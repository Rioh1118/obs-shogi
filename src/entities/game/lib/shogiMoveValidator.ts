import {
  wouldBeInCheckAfterMove,
  canPromote,
  mustPromote,
  getLegalDrops,
} from "./moveValidation";
import type { MoveValidator } from "../model/moveValidator";
import type { Color, Kind, Shogi } from "shogi.js";
import type { ShogiMove } from "../model/types";

export class ShogiMoveValidator implements MoveValidator {
  getLegalMovesFrom(shogi: Shogi, x: number, y: number): ShogiMove[] {
    const basicMoves = shogi.getMovesFrom(x, y);
    return basicMoves.filter((move) => !wouldBeInCheckAfterMove(shogi, move));
  }

  getLegalDropsByKind(shogi: Shogi, color: Color, kind: Kind): ShogiMove[] {
    return getLegalDrops(shogi, color, kind);
  }

  canPromote(shogi: Shogi, move: ShogiMove): boolean {
    return canPromote(shogi, move);
  }

  mustPromote(shogi: Shogi, move: ShogiMove): boolean {
    return mustPromote(shogi, move);
  }
}
