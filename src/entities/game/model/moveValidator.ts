import type { Color, Kind, Shogi } from "shogi.js";
import type { ShogiMove } from "./types";

export interface MoveValidator {
  getLegalMovesFrom(shogi: Shogi, x: number, y: number): ShogiMove[];
  getLegalDropsByKind(shogi: Shogi, color: Color, kind: Kind): ShogiMove[];

  canPromote(shogi: Shogi, move: ShogiMove): boolean;
  mustPromote(shogi: Shogi, move: ShogiMove): boolean;
}
