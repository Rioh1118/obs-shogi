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
  isLegalMove(shogi: Shogi, move: ShogiMove): boolean {
    try {
      if (move.from) {
        const legalMoves = this.getLegalMovesFrom(shogi, move.from.x, move.from.y);
        return legalMoves.some((legal) => legal.to.x === move.to.x && legal.to.y === move.to.y);
      } else {
        if (move.color === undefined || !move.kind) return false;

        const legalDrops = this.getLegalDropsByKind(shogi, move.color, move.kind);

        return legalDrops.some((legal) => legal.to.x === move.to.x && legal.to.y === move.to.y);
      }
    } catch {
      return false;
    }
  }

  getLegalMovesFrom(shogi: Shogi, x: number, y: number): ShogiMove[] {
    const piece = shogi.get(x, y);
    if (!piece) return [];

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
