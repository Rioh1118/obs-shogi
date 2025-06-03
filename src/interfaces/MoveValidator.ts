import type { JKFState, ShogiMove } from "@/types";

import type { SelectedPosition } from "@/types/state";

export interface MoveValidator {
  // 基本的な合法性チェック
  isLegalMove(state: JKFState, move: ShogiMove): boolean;

  // 合法手生成
  getLegalMovesFrom(state: JKFState, x: number, y: number): ShogiMove[];

  // 選択位置からの合法手計算
  calculateLegalMovesForPosition(
    state: JKFState,
    position: SelectedPosition,
  ): ShogiMove[];

  // 成り判定
  canPromote(state: JKFState, move: ShogiMove): boolean;
  mustPromote(state: JKFState, move: ShogiMove): boolean;

  // UI用：成り選択肢付き合法手
  getLegalMovesWithPromotionOptions(
    state: JKFState,
    x: number,
    y: number,
  ): Array<{
    move: ShogiMove;
    canPromote: boolean;
    mustPromote: boolean;
  }>;
}
