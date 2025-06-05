import type { BranchNavigator } from "@/interfaces";
import type { GameStateManager } from "./GameStateManager";
import type { JKFEditor } from "@/interfaces";
import type { GameState } from "@/types/state";
import { Err, type Result, type JKFBranchPath, type ShogiMove } from "@/types";
import {
  canNavigateToIndex,
  createBranchPath,
  getAvailableBranches,
  getBranchDepth,
  getParentBranch,
  isValidBranchPath,
} from "@/utils/branch";
import type { MoveConvertOptions } from "@/adapter/moveConverter";

export class BranchManager implements BranchNavigator {
  private stateManager: GameStateManager;
  private jkfEditor: JKFEditor;

  constructor(stateManager: GameStateManager, jkfEditor: JKFEditor) {
    this.stateManager = stateManager;
    this.jkfEditor = jkfEditor;
  }

  switchToBranch(branchPath: JKFBranchPath): Result<GameState, string> {
    try {
      const currentState = this.stateManager.getCurrentState();
      if (!currentState.originalJKF) {
        return Err("No game loaded");
      }

      // 分岐パスの妥当性をチェック
      if (!isValidBranchPath(currentState.originalJKF, branchPath)) {
        return Err("Invalid branch path");
      }

      // 現在のインデックスで指定した分岐に移動可能かチェック
      const currentIndex = currentState.progress.currentJKFIndex;
      if (
        !canNavigateToIndex(currentState.originalJKF, branchPath, currentIndex)
      ) {
        return Err("Cannot navigate to branch at current index");
      }

      // GameStateManagerのnavigationメソッドを使用
      return this.stateManager.goToJKFIndexWithBranch(currentIndex, branchPath);
    } catch (error) {
      return Err(
        `Failed to switch branch: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  createBranch(
    move: ShogiMove,
    options: MoveConvertOptions,
  ): Result<GameState, string> {
    try {
      const currentState = this.stateManager.getCurrentState();
      if (!currentState.originalJKF || !currentState.shogiGame) {
        return Err("No game loaded");
      }

      // 新しい分岐を作成
      const createBranchResult = this.jkfEditor.createNewForkWithMove(
        currentState.originalJKF,
        move,
        currentState.progress.currentJKFIndex,
        currentState.progress.currentBranchPath,
        options,
      );

      if (!createBranchResult.success) {
        return Err(createBranchResult.error);
      }

      // 新しいJKFデータで状態を更新
      this.stateManager.setJKFData(createBranchResult.data.newJKF);

      // 新しい分岐パスに切り替え
      const newBranchPath = createBranchResult.data.newBranchPath;
      return this.stateManager.goToJKFIndexWithBranch(
        currentState.progress.currentJKFIndex,
        newBranchPath,
      );
    } catch (error) {
      return Err(
        `Failed to create branch: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  deleteBranch(): Result<GameState, string> {
    try {
      const currentState = this.stateManager.getCurrentState();
      if (!currentState.originalJKF) {
        return Err("No game loaded");
      }

      // メイン分岐は削除できない
      if (currentState.progress.currentBranchPath.forkHistory.length === 0) {
        return Err("Cannot delete main branch");
      }

      // 現在の分岐がフォークの場合、そのフォークを削除
      const forkHistory = currentState.progress.currentBranchPath.forkHistory;
      const lastFork = forkHistory[forkHistory.length - 1];

      // 親分岐パスを取得
      const parentBranchPath = getParentBranch(
        currentState.progress.currentBranchPath,
      );
      if (!parentBranchPath) {
        return Err("Cannot get parent branch");
      }

      // 分岐を削除
      const deleteForkResult = this.jkfEditor.deleteFork(
        currentState.originalJKF,
        lastFork.moveIndex,
        parentBranchPath,
        lastFork.forkIndex,
      );

      if (!deleteForkResult.success) {
        return Err(deleteForkResult.error);
      }

      this.stateManager.setJKFData(deleteForkResult.data);

      return this.stateManager.goToJKFIndexWithBranch(
        lastFork.moveIndex,
        parentBranchPath,
      );
    } catch (error) {
      return Err(
        `Failed to delete branch: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  getAvailableBranches(): JKFBranchPath[] {
    const currentState = this.stateManager.getCurrentState();
    if (!currentState.originalJKF) {
      return [];
    }

    const branches = getAvailableBranches(
      currentState.originalJKF,
      currentState.progress.currentJKFIndex,
    );

    return branches.map((branch) => {
      // 現在の分岐パスのforkHistoryをコピーして、新しいフォークを追加
      const newForkHistory = [
        ...currentState.progress.currentBranchPath.forkHistory,
        {
          moveIndex: branch.moveIndex,
          forkIndex: branch.forkIndex,
        },
      ];

      return createBranchPath(
        currentState.progress.currentBranchPath.mainMoveIndex,
        newForkHistory,
      );
    });
  }

  getCurrentBranchPath(): JKFBranchPath {
    const currentState = this.stateManager.getCurrentState();
    return currentState.progress.currentBranchPath;
  }

  getBranchDepth(): number {
    const currentState = this.stateManager.getCurrentState();
    return getBranchDepth(currentState.progress.currentBranchPath);
  }
}
