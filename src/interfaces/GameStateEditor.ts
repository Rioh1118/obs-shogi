import type { Result, JKFBranchPath, JKFData, ShogiMove } from "@/types";
import type { GameState } from "@/types/state";

export interface GameStateEditor {
  // ゲーム初期化
  loadGame(jkf: JKFData): Result<GameState, string>;

  // 手の実行
  makeMove(move: ShogiMove, promote?: boolean): Result<GameState, string>;

  // コメント・特殊情報
  addComment(
    comment: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<GameState, string>;
  addSpecial(
    special: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<GameState, string>;
}
