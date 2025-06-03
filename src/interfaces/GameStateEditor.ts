import type { AsyncResult, JKFBranchPath, JKFData, ShogiMove } from "@/types";
import type { GameState } from "@/types/state";

export interface GameStateEditor {
  // ゲーム初期化
  loadGame(jkf: JKFData): AsyncResult<GameState, string>;

  // 手の実行
  makeMove(move: ShogiMove, promote?: boolean): AsyncResult<GameState, string>;

  // コメント・特殊情報
  addComment(
    comment: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): AsyncResult<GameState, string>;
  addSpecial(
    special: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): AsyncResult<GameState, string>;
}
