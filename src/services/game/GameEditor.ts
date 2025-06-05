import type {
  GameStateEditor,
  JKFEditor,
  JKFReader,
  MoveValidator,
} from "@/interfaces";
import type { GameState } from "@/types/state";
import type { ShogiMove, JKFData, JKFBranchPath, Result } from "@/types";
import { GameStateManager } from "./GameStateManager";
import { Ok, Err } from "@/types";
import { Shogi } from "shogi.js";
import {
  convertIMoveFormatToIMove,
  convertJKFStateToShogiSetting,
} from "@/adapter/convertToISetting";
import {
  createBranchPath,
  getAvailableBranches,
  getBranchDepth,
  getParentBranch,
  getTotalMovesInBranch,
  isAtBranchEnd,
} from "@/utils/branch";
import { createMoveConvertOptions } from "@/adapter/moveConverter";

export class GameEditor implements GameStateEditor {
  private jkfEditor: JKFEditor;
  private jkfReader: JKFReader;
  private moveValidator: MoveValidator;
  private stateManager: GameStateManager;

  constructor(
    jkfEditor: JKFEditor,
    jkfReader: JKFReader,
    moveValidator: MoveValidator,
    stateManager: GameStateManager,
  ) {
    this.jkfEditor = jkfEditor;
    this.jkfReader = jkfReader;
    this.moveValidator = moveValidator;
    this.stateManager = stateManager;
  }

  loadGame(jkf: JKFData): Result<GameState, string> {
    try {
      // 1. JKFAnalyzerで初期状態を取得
      const initialState = this.jkfReader.getInitialState(jkf);
      if (!initialState) {
        return Err("Failed to get initial state from JKF");
      }

      // 2. JKFStateをShogiのISettingTypeに変換
      const shogiSetting = convertJKFStateToShogiSetting(initialState);

      // 3. Shogiインスタンスを初期状態で作成
      const shogiGame = new Shogi(shogiSetting);
      const initialBranchPath = createBranchPath(0);

      // 4. GameStateManagerを初期化
      this.stateManager.initializeFromJKF(jkf, shogiGame, initialBranchPath);

      // 5. 分岐情報を計算
      const availableBranches = getAvailableBranches(jkf, 0);
      const branchesWithDetails = availableBranches.map((branch) => {
        // JKFAnalyzerで分岐の詳細情報を取得
        const forks = this.jkfReader.getAvailableForks(
          jkf,
          branch.moveIndex,
          initialBranchPath,
        );
        const targetFork = forks[branch.forkIndex];
        const comments = this.jkfReader.getCommentsAt(
          jkf,
          branch.moveIndex,
          initialBranchPath,
        );

        return {
          moveIndex: branch.moveIndex,
          forkIndex: branch.forkIndex,
          previewMove:
            convertIMoveFormatToIMove(targetFork?.firstMove) ?? undefined,
          comment: comments.length > 0 ? comments.join(" ") : undefined,
        };
      });

      this.stateManager.setBranchNavigation({
        currentPath: initialBranchPath,
        availableBranches: branchesWithDetails,
        parentBranch: getParentBranch(initialBranchPath),
        branchDepth: getBranchDepth(initialBranchPath),
      });

      return Ok(this.stateManager.getCurrentState());
    } catch (error) {
      return Err(
        `Failed to load game: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  makeMove(move: ShogiMove, promote?: boolean): Result<GameState, string> {
    try {
      const currentState = this.stateManager.getCurrentState();
      if (!currentState?.shogiGame) {
        return Err("No game loaded");
      }

      // 1. 手の妥当性チェック
      const isLegal = this.moveValidator.isLegalMove(
        currentState.shogiGame,
        move,
      );
      if (!isLegal) {
        return Err("Illegal move");
      }

      // 2. 成りの判定
      let shouldPromote = promote;
      if (shouldPromote === undefined) {
        // 成りが必須かチェック
        if (this.moveValidator.mustPromote(currentState.shogiGame, move)) {
          shouldPromote = true;
        } else {
          shouldPromote = false;
        }
      } else if (shouldPromote) {
        if (!this.moveValidator.canPromote(currentState.shogiGame, move)) {
          return Err("Cannot promote this move");
        }
      }

      const options = createMoveConvertOptions(currentState, move, {
        promote: shouldPromote,
      });
      // 4. JKFEditorで手を追加
      const addMoveResult = this.jkfEditor.addMove(
        currentState.originalJKF!,
        move,
        currentState.progress.currentBranchPath,
        currentState.progress.currentJKFIndex,
        options,
      );

      if (!addMoveResult.success) {
        return Err(addMoveResult.error);
      }

      // 5. Shogiインスタンスで実際の手を実行
      const newShogiGame = structuredClone(currentState.shogiGame);

      if (move.from) {
        // 移動の場合
        newShogiGame.move(
          move.from.x,
          move.from.y,
          move.to.x,
          move.to.y,
          shouldPromote,
        );
      } else {
        // 駒打ちの場合
        newShogiGame.drop(move.to.x, move.to.y, move.kind!, move.color);
      }

      // 6. 新しい分岐情報を計算
      const newBranchPath = addMoveResult.data.resultBranchPath;
      const newIndex = currentState.progress.currentJKFIndex + 1;
      const availableBranches = getAvailableBranches(
        addMoveResult.data.newJKF,
        newIndex,
      );

      const branchesWithDetails = availableBranches.map((branch) => {
        const forks = this.jkfReader.getAvailableForks(
          addMoveResult.data.newJKF,
          branch.moveIndex,
          newBranchPath,
        );
        const targetFork = forks[branch.forkIndex];
        const comments = this.jkfReader.getCommentsAt(
          addMoveResult.data.newJKF,
          branch.moveIndex,
          newBranchPath,
        );
        // convertIMoveFormatToIMoveの結果がnullの場合はundefinedに変換
        const previewMove = targetFork?.firstMove
          ? convertIMoveFormatToIMove(targetFork.firstMove) || undefined
          : undefined;
        return {
          moveIndex: branch.moveIndex,
          forkIndex: branch.forkIndex,
          previewMove: previewMove,
          comment: comments.length > 0 ? comments.join(" ") : undefined,
        };
      });

      // 8. GameStateを更新
      this.stateManager.setJKFData(addMoveResult.data.newJKF);
      this.stateManager.setShogiGame(newShogiGame);
      this.stateManager.setLastMove(move);
      this.stateManager.setSelectedPosition(null);
      this.stateManager.setLegalMoves([]);

      // progressを更新
      this.stateManager.setProgress({
        currentJKFIndex: newIndex,
        actualMoveCount: currentState.progress.actualMoveCount + 1,
        currentBranchPath: newBranchPath,
        totalMovesInBranch: getTotalMovesInBranch(
          addMoveResult.data.newJKF,
          newBranchPath,
        ),
        isAtBranchEnd: isAtBranchEnd(
          addMoveResult.data.newJKF,
          newBranchPath,
          newIndex,
        ),
      });

      this.stateManager.setBranchNavigation({
        currentPath: newBranchPath,
        availableBranches: branchesWithDetails,
        parentBranch: getParentBranch(newBranchPath),
        branchDepth: getBranchDepth(newBranchPath),
      });

      return Ok(this.stateManager.getCurrentState());
    } catch (error) {
      return Err(
        `Failed to make move: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  addComment(
    comment: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<GameState, string> {
    try {
      const currentState = this.stateManager.getCurrentState();
      if (!currentState) {
        return Err("No game loaded");
      }

      const result = this.jkfEditor.addComment(
        currentState.originalJKF!,
        comment,
        moveIndex,
        branchPath,
      );

      if (!result.success) {
        return Err(result.error);
      }

      this.stateManager.setJKFData(result.data);

      return Ok(this.stateManager.getCurrentState());
    } catch (error) {
      return Err(
        `Failed to add comment: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  addSpecial(
    special: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<GameState, string> {
    try {
      const currentState = this.stateManager.getCurrentState();
      if (!currentState) {
        return Err("No game loaded");
      }

      const result = this.jkfEditor.addSpecial(
        currentState.originalJKF!,
        special,
        moveIndex,
        branchPath,
      );

      if (!result.success) {
        return Err(result.error);
      }

      this.stateManager.setJKFData(result.data);

      return Ok(this.stateManager.getCurrentState());
    } catch (error) {
      return Err(
        `Failed to add special: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
