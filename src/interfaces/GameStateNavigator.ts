import type { Result, JKFBranchPath } from "@/types";
import type { GameState } from "@/types/state";

export interface GameStateNavigator {
  // 基本移動
  nextElement(): Result<GameState, string>;
  previousElement(): Result<GameState, string>;
  goToStart(): Result<GameState, string>;
  goToEnd(): Result<GameState, string>;

  goToJKFIndex(index: number): Result<GameState, string>;
  goToJKFIndexWithBranch(
    index: number,
    branchPath: JKFBranchPath,
  ): Result<GameState, string>;
}
