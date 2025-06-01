import type { JKFFormat } from "../types/kifu";
import { Shogi } from "shogi.js";
import type { IMove } from "shogi.js";
import type { JKFBranchPath } from "../types/game";
import { GameEngine } from "./GameEngine";
import {
  JKFEditor,
  type EditResult,
  type BranchCreationResult,
} from "./JKFEditors";
import { JKFNavigator } from "./JKFNavigator";
import { LegalMoveGenerator } from "./LegalMoveGenerator";
import KifuWriter from "../commands/kifuWriter";

export interface MoveValidationResult {
  isValid: boolean;
  canPromote?: boolean;
  mustPromote?: boolean;
  error?: string;
}

export interface GameStateResult {
  jkf: JKFFormat;
  branchPath: JKFBranchPath;
  currentIndex: number;
  gameEngine: ReturnType<typeof GameEngine.applyMovesToIndexWithBranch>;
}

/**
 * 将棋の手の操作を管理するサービス
 * GameEngineとJKFEditorを組み合わせて、ゲーム状態の管理と棋譜編集を行う
 */
export class MoveService {
  /**
   * 手を追加（メイン機能）
   * - 合法手チェック
   * - JKF更新
   * - ゲーム状態更新
   */
  static addMove(
    jkf: JKFFormat,
    move: IMove,
    currentIndex: number,
    branchPath: JKFBranchPath,
    options: {
      comment?: string;
      createBranch?: boolean;
      promote?: boolean;
    } = {},
  ): EditResult & { gameState?: GameStateResult } {
    try {
      // 1. 現在の局面を復元
      const gameResult = GameEngine.applyMovesToIndexWithBranch(
        jkf,
        currentIndex,
        branchPath,
      );
      if (!gameResult.success) {
        return {
          success: false,
          error: `Failed to restore game state: ${gameResult.error}`,
        };
      }

      // 2. 合法手チェック
      const validation = this.validateMove(
        gameResult.shogi,
        move,
        options.promote,
      );
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error || "Invalid move",
        };
      }

      // 3. 分岐作成が必要かチェック
      const needsBranch =
        options.createBranch ||
        this.shouldCreateBranch(jkf, currentIndex, branchPath);

      let result: EditResult;
      if (needsBranch) {
        // 新しい分岐を作成
        const branchResult = JKFEditor.createBranch(
          jkf,
          currentIndex,
          branchPath,
          move,
          options.comment,
        );
        result = branchResult;
      } else {
        // 既存の分岐に追加
        const insertIndex = currentIndex + 1;
        result = JKFEditor.addMove(
          jkf,
          move,
          insertIndex,
          branchPath,
          options.comment,
        );
      }

      if (!result.success) {
        return result;
      }

      // 4. 新しいゲーム状態を作成
      const newGameState = this.createGameState(
        result.newJkf!,
        result.newBranchPath!,
        result.newIndex!,
      );

      return {
        ...result,
        gameState: newGameState,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add move: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 手を削除
   */
  static deleteMove(
    jkf: JKFFormat,
    targetIndex: number,
    branchPath: JKFBranchPath,
  ): EditResult & { gameState?: GameStateResult } {
    const result = JKFEditor.deleteMove(jkf, targetIndex, branchPath);
    if (result.success && result.newJkf && result.newBranchPath !== undefined) {
      const gameState = this.createGameState(
        result.newJkf,
        result.newBranchPath,
        result.newIndex || 0,
      );
      return { ...result, gameState };
    }
    return result;
  }

  /**
   * 分岐を作成
   */
  static createBranch(
    jkf: JKFFormat,
    branchFromIndex: number,
    branchPath: JKFBranchPath,
    initialMove?: IMove,
    comment?: string,
  ): BranchCreationResult & { gameState?: GameStateResult } {
    // 初期手がある場合は合法手チェック
    if (initialMove) {
      const gameResult = GameEngine.applyMovesToIndexWithBranch(
        jkf,
        branchFromIndex,
        branchPath,
      );
      if (gameResult.success) {
        const validation = this.validateMove(gameResult.shogi, initialMove);
        if (!validation.isValid) {
          return {
            success: false,
            error: validation.error || "Invalid initial move for branch",
          };
        }
      }
    }

    const result = JKFEditor.createBranch(
      jkf,
      branchFromIndex,
      branchPath,
      initialMove,
      comment,
    );

    if (result.success && result.newJkf && result.newBranchPath) {
      const gameState = this.createGameState(
        result.newJkf,
        result.newBranchPath,
        result.newIndex || branchFromIndex,
      );
      return { ...result, gameState };
    }
    return result;
  }

  /**
   * 分岐を削除
   */
  static deleteBranch(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): EditResult & { gameState?: GameStateResult } {
    const result = JKFEditor.deleteBranch(jkf, branchPath);
    if (result.success && result.newJkf && result.newBranchPath !== undefined) {
      const gameState = this.createGameState(
        result.newJkf,
        result.newBranchPath,
        result.newIndex || 0,
      );
      return { ...result, gameState };
    }
    return result;
  }

  /**
   * 変化を本譜に昇格
   */
  static promoteVariation(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): EditResult & { gameState?: GameStateResult } {
    const result = JKFEditor.promoteVariation(jkf, branchPath);
    if (result.success && result.newJkf && result.newBranchPath !== undefined) {
      const gameState = this.createGameState(
        result.newJkf,
        result.newBranchPath,
        result.newIndex || 0,
      );
      return { ...result, gameState };
    }
    return result;
  }

  /**
   * コメントを編集
   */
  static editComment(
    jkf: JKFFormat,
    targetIndex: number,
    branchPath: JKFBranchPath,
    comment: string,
  ): EditResult {
    return JKFEditor.editComment(jkf, targetIndex, branchPath, comment);
  }

  /**
   * 手を変更
   */
  static editMove(
    jkf: JKFFormat,
    targetIndex: number,
    branchPath: JKFBranchPath,
    newMove: IMove,
  ): EditResult & { gameState?: GameStateResult } {
    // 新しい手の合法性をチェック
    const gameResult = GameEngine.applyMovesToIndexWithBranch(
      jkf,
      targetIndex - 1,
      branchPath,
    );
    if (gameResult.success) {
      const validation = this.validateMove(gameResult.shogi, newMove);
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error || "Invalid replacement move",
        };
      }
    }

    const result = JKFEditor.editMove(jkf, targetIndex, branchPath, newMove);
    if (result.success && result.newJkf && result.newBranchPath !== undefined) {
      const gameState = this.createGameState(
        result.newJkf,
        result.newBranchPath,
        result.newIndex || targetIndex,
      );
      return { ...result, gameState };
    }
    return result;
  }

  /**
   * 指定位置の合法手を取得
   */
  static getLegalMoves(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): IMove[] {
    const gameResult = GameEngine.applyMovesToIndexWithBranch(
      jkf,
      currentIndex,
      branchPath,
    );
    if (!gameResult.success) {
      return [];
    }

    // 修正: generateAllMoves → getAllLegalMoves
    return LegalMoveGenerator.getAllLegalMoves(
      gameResult.shogi,
      gameResult.shogi.turn,
    );
  }

  /**
   * 棋譜ファイルを保存
   */
  static async saveToFile(jkf: JKFFormat, filePath: string): Promise<void> {
    try {
      const format = KifuWriter.getFormatFromPath(filePath);
      await KifuWriter.writeToFile(jkf, filePath, format);
      console.log("棋譜ファイルを保存しました:", filePath);
    } catch (error) {
      console.error("ファイル保存に失敗:", error);
      throw error;
    }
  }

  /**
   * ゲーム状態を復元
   */
  static restoreGameState(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): GameStateResult | null {
    try {
      return this.createGameState(jkf, branchPath, currentIndex);
    } catch {
      return null;
    }
  }

  // ===== Private Helper Methods =====

  /**
   * 手の合法性をチェック
   */
  private static validateMove(
    shogi: Shogi,
    move: IMove,
    forcePromote?: boolean,
  ): MoveValidationResult {
    try {
      // 修正: generateAllMoves → getAllLegalMoves
      const legalMoves = LegalMoveGenerator.getAllLegalMoves(shogi, shogi.turn);
      const isLegal = legalMoves.some((legalMove: IMove) =>
        this.movesEqual(legalMove, move),
      );

      if (!isLegal) {
        return {
          isValid: false,
          error: "Illegal move",
        };
      }

      // 成り判定
      const canPromote = LegalMoveGenerator.canPromote(shogi, move);
      const mustPromote = LegalMoveGenerator.mustPromote(shogi, move);

      if (forcePromote && !canPromote) {
        return {
          isValid: false,
          error: "Cannot promote this move",
        };
      }

      if (mustPromote && !forcePromote) {
        return {
          isValid: false,
          error: "Must promote this move",
        };
      }

      return {
        isValid: true,
        canPromote,
        mustPromote,
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 分岐作成が必要かチェック
   */
  private static shouldCreateBranch(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): boolean {
    const nextMove = JKFNavigator.getNextMove(jkf, currentIndex, branchPath);
    return nextMove !== null;
  }

  /**
   * 手の比較
   */
  private static movesEqual(move1: IMove, move2: IMove): boolean {
    return (
      move1.to.x === move2.to.x &&
      move1.to.y === move2.to.y &&
      move1.kind === move2.kind &&
      move1.color === move2.color &&
      ((move1.from &&
        move2.from &&
        move1.from.x === move2.from.x &&
        move1.from.y === move2.from.y) ||
        (!move1.from && !move2.from))
    );
  }

  /**
   * ゲーム状態を作成
   */
  private static createGameState(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
    currentIndex: number,
  ): GameStateResult {
    const gameEngine = GameEngine.applyMovesToIndexWithBranch(
      jkf,
      currentIndex,
      branchPath,
    );

    return {
      jkf,
      branchPath,
      currentIndex,
      gameEngine,
    };
  }

  /**
   * 手の情報を補完（piece、kindプロパティなどを設定）
   */
  static enrichMove(shogi: Shogi, move: IMove): IMove {
    try {
      const enrichedMove: IMove = { ...move };

      // fromがある場合（盤上の駒を移動）
      if (move.from) {
        const piece = shogi.get(move.from.x, move.from.y);
        if (piece) {
          // kindが未設定の場合は元の駒種を設定
          if (!enrichedMove.kind) {
            enrichedMove.kind = piece.kind;
          }
        }
      }

      // colorが未設定の場合は現在の手番を設定
      if (!enrichedMove.color) {
        enrichedMove.color = shogi.turn;
      }

      return enrichedMove;
    } catch (error) {
      console.warn("Failed to enrich move:", error);
      return move; // エラーの場合は元のmoveを返す
    }
  }
}
