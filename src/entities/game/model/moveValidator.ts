import type { Color, Kind, Shogi } from "shogi.js";
import type { ShogiMove } from "./types";

export interface MoveValidator {
  // 基本的な合法性チェック
  isLegalMove(shogi: Shogi, move: ShogiMove): boolean;

  // 合法手生成
  getLegalMovesFrom(shogi: Shogi, x: number, y: number): ShogiMove[];
  getLegalDropsByKind(shogi: Shogi, color: Color, kind: Kind): ShogiMove[];

  // 成り判定
  canPromote(shogi: Shogi, move: ShogiMove): boolean;
  mustPromote(shogi: Shogi, move: ShogiMove): boolean;
}
