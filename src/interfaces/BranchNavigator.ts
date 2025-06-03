import type { Result, JKFBranchPath, ShogiMove } from "@/types";
import type { GameState } from "@/types/state";

export interface BranchNavigator {
  // 分岐操作
  switchToBranch(branchPath: JKFBranchPath): Result<GameState, string>;
  createBranch(move: ShogiMove): Result<GameState, string>;
  deleteBranch(): Result<GameState, string>;

  // 分岐情報を取得
  getAvailableBranches(): JKFBranchPath[];
  getCurrentBranchPath(): JKFBranchPath;
  getBranchDepth(): number;
}
