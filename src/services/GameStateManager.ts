import { Color, Shogi, type Piece, type IMove } from "shogi.js";
import { GameEngine } from "./GameEngine";
import { JKFNavigator } from "./JKFNavigator";
import { JKFAnalyzer } from "./JKFAnalyzer";
import { JKFEditor, type EditResult } from "./JKFEditors";
import { LegalMoveGenerator } from "./LegalMoveGenerator";
import { MoveService } from "./MoveService";
import type { JKFFormat } from "../types/kifu";
import type {
  JKFBranchPath,
  GameProgress,
  BranchNavigationInfo,
  SelectedPosition,
  JKFBranchInfo,
} from "../types/game";
import { JKFConverter } from "../utils/JKFConverter";

// GameStateManager の戻り値型
export interface GameStateResult {
  success: boolean;
  error?: string;
  shogiGame?: Shogi;
  lastMove?: IMove | null;
  progress?: GameProgress;
  branchNavigation?: BranchNavigationInfo;
  currentBoard?: Piece[][] | null;
  currentHands?: Piece[][] | null;
  currentTurn?: Color | null;
}

export interface MoveExecutionResult {
  success: boolean;
  error?: string;
  newJKF?: JKFFormat;
  newBranchPath?: JKFBranchPath;
  move?: IMove;
  gameState?: GameStateResult;
}

export interface LegalMovesResult {
  success: boolean;
  error?: string;
  legalMoves: IMove[];
}

export class GameStateManager {
  // ===== ナビゲーション系 =====
  /**
   * 指定されたインデックスと分岐パスにゲーム状態を移動
   */
  static goToIndex(
    jkf: JKFFormat,
    targetIndex: number,
    branchPath: JKFBranchPath,
  ): GameStateResult {
    try {
      // 1. GameEngineでShogi.jsの状態を構築
      const gameResult = GameEngine.applyMovesToIndexWithBranch(
        jkf,
        targetIndex,
        branchPath,
      );
      if (!gameResult.success) {
        return {
          success: false,
          error: gameResult.error || "ゲーム状態の構築に失敗",
        };
      }

      // 2. JKFAnalyzerで進行状況を計算
      const progress = JKFAnalyzer.calculateProgress(
        jkf,
        targetIndex,
        branchPath,
      );

      // 3. JKFAnalyzerで分岐情報を計算
      const branchNavigation = JKFAnalyzer.calculateBranchNavigation(
        jkf,
        branchPath,
      );

      return {
        success: true,
        shogiGame: gameResult.shogi,
        lastMove: gameResult.lastMove,
        progress,
        branchNavigation,
        currentBoard: gameResult.shogi?.board || null,
        currentHands: gameResult.shogi?.hands || null,
        currentTurn: gameResult.shogi?.turn || null,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "不明なエラー",
      };
    }
  }

  /**
   * 次の手に移動
   */
  static goToNext(
    jkf: JKFFormat,
    currentIndex: number,
    currentBranchPath: JKFBranchPath,
  ): GameStateResult {
    try {
      const nextInfo = JKFNavigator.getNextMove(
        jkf,
        currentIndex,
        currentBranchPath,
      );
      if (!nextInfo) {
        return {
          success: false,
          error: "次の手がありません",
        };
      }

      return this.goToIndex(jkf, nextInfo.newIndex, nextInfo.newBranchPath);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "次の手への移動に失敗",
      };
    }
  }

  /**
   * 前の手に移動
   */
  static goToPrevious(
    jkf: JKFFormat,
    currentIndex: number,
    currentBranchPath: JKFBranchPath,
  ): GameStateResult {
    try {
      const prevInfo = JKFNavigator.getPreviousMove(
        jkf,
        currentIndex,
        currentBranchPath,
      );
      if (!prevInfo) {
        return {
          success: false,
          error: "前の手がありません",
        };
      }

      return this.goToIndex(jkf, prevInfo.newIndex, prevInfo.newBranchPath);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "前の手への移動に失敗",
      };
    }
  }

  /**
   * 開始局面に移動
   */
  static goToStart(jkf: JKFFormat): GameStateResult {
    return this.goToIndex(jkf, 0, { mainMoveIndex: 0, forkHistory: [] });
  }

  /**
   * 最終手に移動
   */
  static goToEnd(
    jkf: JKFFormat,
    currentBranchPath: JKFBranchPath,
  ): GameStateResult {
    try {
      const endInfo = JKFNavigator.goToEnd(jkf, currentBranchPath);
      if (!endInfo) {
        return {
          success: false,
          error: "最終手への移動に失敗",
        };
      }
      return this.goToIndex(jkf, endInfo.newIndex, currentBranchPath);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "最終手への移動に失敗",
      };
    }
  }

  // ===== 選択・合法手系 =====
  /**
   * 選択された位置から合法手を計算
   */
  static calculateLegalMoves(
    shogiGame: Shogi,
    selection: SelectedPosition,
  ): LegalMovesResult {
    try {
      let legalMoves: IMove[] = [];
      if (selection.type === "square") {
        // 盤上の駒の合法手
        legalMoves = LegalMoveGenerator.getLegalMovesFrom(
          shogiGame,
          selection.x,
          selection.y,
        );
      } else if (selection.type === "hand") {
        // 持ち駒の合法手（打てる場所）
        legalMoves = LegalMoveGenerator.getLegalDropsByKind(
          shogiGame,
          selection.color,
          selection.kind,
        );
      }

      return {
        success: true,
        legalMoves,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "合法手の計算に失敗",
        legalMoves: [],
      };
    }
  }

  // ===== 手の実行系 =====
  /**
   * 手を実行してJKFを更新
   */
  static executeMove(
    jkf: JKFFormat,
    shogiGame: Shogi,
    selectedPosition: SelectedPosition,
    targetSquare: { x: number; y: number },
    currentIndex: number,
    currentBranchPath: JKFBranchPath,
  ): MoveExecutionResult {
    try {
      // 1. 手を構築
      const move = this.buildMoveFromSelection(
        shogiGame,
        selectedPosition,
        targetSquare,
      );
      if (!move.success) {
        return {
          success: false,
          error: move.error,
        };
      }

      // 2. 合法性チェック
      const isLegal = LegalMoveGenerator.isLegalMove(shogiGame, move.move!);
      if (!isLegal) {
        return {
          success: false,
          error: "不正な手です",
        };
      }

      // 3. 分岐チェック（既存のforksを調査）
      const branchInfo = this.checkForExistingBranch(
        jkf,
        move.move!,
        currentIndex,
        currentBranchPath,
      );

      let newJKF: JKFFormat;
      let newBranchPath: JKFBranchPath;

      if (branchInfo.existingBranch) {
        // 既存の分岐に移動
        newJKF = jkf;
        newBranchPath = branchInfo.branchPath!;
      } else {
        // 新しい手を追加（必要に応じて分岐作成）
        const addResult = MoveService.addMove(
          jkf,
          move.move!,
          currentIndex + 1,
          currentBranchPath,
        );
        if (
          !addResult.success ||
          !addResult.newJkf ||
          !addResult.newBranchPath
        ) {
          return {
            success: false,
            error: addResult.error,
          };
        }
        newJKF = addResult.newJkf;
        newBranchPath = addResult.newBranchPath || currentBranchPath;
      }

      // 4. 新しいゲーム状態を計算
      const newGameState = this.goToIndex(
        newJKF,
        currentIndex + 1,
        newBranchPath,
      );
      if (!newGameState.success) {
        return {
          success: false,
          error: newGameState.error,
        };
      }

      return {
        success: true,
        newJKF,
        newBranchPath,
        move: move.move,
        gameState: newGameState,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "手の実行に失敗",
      };
    }
  }

  // ===== 分岐操作系 =====
  /**
   * 指定された分岐に切り替え
   */
  static switchToBranch(
    jkf: JKFFormat,
    targetBranchPath: JKFBranchPath,
  ): GameStateResult {
    try {
      // 分岐の最後の手番を計算
      const endInfo = JKFNavigator.goToEnd(jkf, targetBranchPath);
      if (!endInfo) {
        return {
          success: false,
          error: "分岐の終端が見つかりません",
        };
      }
      return this.goToIndex(jkf, endInfo.newIndex, targetBranchPath);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "分岐の切り替えに失敗",
      };
    }
  }

  // ===== 棋譜編集系 =====
  /**
   * コメントを追加
   */
  static addComment(
    jkf: JKFFormat,
    comment: string,
    targetIndex: number,
    branchPath: JKFBranchPath,
  ): EditResult {
    try {
      const result = JKFEditor.editComment(
        jkf,
        targetIndex,
        branchPath,
        comment,
      );
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "コメントの追加に失敗",
      };
    }
  }

  /**
   * 特殊要素を追加
   */
  static addSpecial(
    jkf: JKFFormat,
    special: string,
    targetIndex: number,
    branchPath: JKFBranchPath,
  ): EditResult {
    try {
      const result = JKFEditor.insertSpecial(
        jkf,
        special,
        targetIndex,
        branchPath,
      );
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "特殊要素の追加に失敗",
      };
    }
  }

  // ===== プライベートヘルパーメソッド =====
  private static buildMoveFromSelection(
    shogiGame: Shogi,
    selectedPosition: SelectedPosition,
    targetSquare: { x: number; y: number },
  ): { success: boolean; error?: string; move?: IMove } {
    try {
      let move: IMove;
      if (selectedPosition.type === "square") {
        // 盤上の駒を移動
        const piece = shogiGame.board[selectedPosition.y][selectedPosition.x];
        if (!piece) {
          return {
            success: false,
            error: "選択された位置に駒がありません",
          };
        }
        move = {
          from: { x: selectedPosition.x, y: selectedPosition.y },
          to: targetSquare,
          kind: piece.kind,
          color: shogiGame.turn,
        };
      } else {
        // 持ち駒を打つ
        move = {
          to: targetSquare,
          kind: selectedPosition.kind,
          color: selectedPosition.color,
        };
      }

      // MoveServiceで手を補完
      const enrichedMove = MoveService.enrichMove(shogiGame, move);
      return {
        success: true,
        move: enrichedMove,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "手の構築に失敗",
      };
    }
  }

  private static checkForExistingBranch(
    jkf: JKFFormat,
    move: IMove,
    currentIndex: number,
    currentBranchPath: JKFBranchPath,
  ): { existingBranch: boolean; branchPath?: JKFBranchPath } {
    try {
      // JKFAnalyzerを使って既存の分岐をチェック
      const branchInfo = JKFAnalyzer.getBranchInfo(jkf, currentIndex);

      // 各分岐の最初の手をチェック
      for (const branch of branchInfo) {
        const forkData =
          jkf.moves?.[branch.moveIndex]?.forks?.[branch.forkIndex];
        if (forkData && forkData.length > 0 && forkData[0].move) {
          const jkfMove = JKFConverter.toIMove(forkData[0].move);
          if (this.movesEqual(move, jkfMove)) {
            return {
              existingBranch: true,
              branchPath: {
                mainMoveIndex: currentBranchPath.mainMoveIndex,
                forkHistory: [
                  ...currentBranchPath.forkHistory,
                  { moveIndex: branch.moveIndex, forkIndex: branch.forkIndex },
                ],
              },
            };
          }
        }
      }

      return { existingBranch: false };
    } catch (error) {
      return { existingBranch: false };
    }
  }

  /**
   * 手の比較
   */
  private static movesEqual(move1: IMove, move2: IMove): boolean {
    try {
      // from位置の比較
      if (move1.from && move2.from) {
        if (move1.from.x !== move2.from.x || move1.from.y !== move2.from.y) {
          return false;
        }
      } else if (move1.from || move2.from) {
        return false; // 一方だけがfromを持つ場合は不一致
      }

      // to位置の比較
      if (move1.to.x !== move2.to.x || move1.to.y !== move2.to.y) {
        return false;
      }

      // 駒の種類の比較
      if (move1.kind !== move2.kind) {
        return false;
      }

      // 成りの比較
      if (move1.color !== move2.color) {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  // ===== 便利メソッド =====
  /**
   * 現在の局面で可能な全ての合法手を取得
   */
  static getAllLegalMoves(shogiGame: Shogi): LegalMovesResult {
    try {
      const allMoves = LegalMoveGenerator.getAllLegalMoves(
        shogiGame,
        shogiGame.turn,
      );
      return {
        success: true,
        legalMoves: allMoves,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "合法手の取得に失敗",
        legalMoves: [],
      };
    }
  }

  /**
   * 指定された手が合法かどうかをチェック
   */
  static validateMove(
    shogiGame: Shogi,
    move: IMove,
  ): { success: boolean; error?: string; isLegal: boolean } {
    try {
      const isLegal = LegalMoveGenerator.isLegalMove(shogiGame, move);
      return {
        success: true,
        isLegal,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "手の検証に失敗",
        isLegal: false,
      };
    }
  }

  /**
   * JKF全体の妥当性をチェック
   */
  static validateJKF(jkf: JKFFormat): { success: boolean; error?: string } {
    try {
      // 基本構造のチェック
      if (!jkf.moves || !Array.isArray(jkf.moves)) {
        return {
          success: false,
          error: "JKFの基本構造が不正です",
        };
      }

      // 各手の妥当性をチェック（簡易版）
      for (let i = 0; i < jkf.moves.length; i++) {
        const element = jkf.moves[i];
        if (element && typeof element !== "object") {
          return {
            success: false,
            error: `手番${i}の形式が不正です`,
          };
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "JKFの検証に失敗",
      };
    }
  }

  /**
   * 現在の分岐パスでの次の手の存在チェック
   */
  static hasNextMove(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): boolean {
    try {
      const nextInfo = JKFNavigator.getNextMove(jkf, currentIndex, branchPath);
      return nextInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * 現在の分岐パスでの前の手の存在チェック
   */
  static hasPreviousMove(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): boolean {
    try {
      const prevInfo = JKFNavigator.getPreviousMove(
        jkf,
        currentIndex,
        branchPath,
      );
      return prevInfo !== null;
    } catch {
      return false;
    }
  }

  /**
   * 現在位置で利用可能な分岐の数を取得
   */
  static getAvailableBranchCount(jkf: JKFFormat, currentIndex: number): number {
    try {
      const branchInfo = JKFAnalyzer.getBranchInfo(jkf, currentIndex);
      return branchInfo.length;
    } catch {
      return 0;
    }
  }

  /**
   * ゲーム状態の完全な再計算（デバッグ用）
   */
  static recalculateGameState(
    jkf: JKFFormat,
    targetIndex: number,
    branchPath: JKFBranchPath,
  ): GameStateResult {
    // JKFの妥当性チェック
    const validation = this.validateJKF(jkf);
    if (!validation.success) {
      return {
        success: false,
        error: `JKF検証エラー: ${validation.error}`,
      };
    }

    // 分岐パスの妥当性チェック
    const pathValid = JKFAnalyzer.validateBranchPath(jkf, branchPath);
    if (!pathValid) {
      return {
        success: false,
        error: "分岐パスが不正です",
      };
    }

    // 通常の状態計算
    return this.goToIndex(jkf, targetIndex, branchPath);
  }

  // ===== 追加の便利メソッド =====

  /**
   * 指定位置の分岐一覧を取得
   */
  static getBranchesAt(
    jkf: JKFFormat,
    index: number,
  ): { success: boolean; error?: string; branches: JKFBranchInfo[] } {
    try {
      const branches = JKFAnalyzer.getBranchInfo(jkf, index);
      return {
        success: true,
        branches,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "分岐情報の取得に失敗",
        branches: [],
      };
    }
  }

  /**
   * 分岐を削除
   */
  static deleteBranch(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): { success: boolean; error?: string; newJKF?: JKFFormat } {
    try {
      const result = JKFEditor.deleteBranch(jkf, branchPath);

      if (!result.success) {
        return {
          success: false,
          error: result.error || "分岐の削除に失敗",
        };
      }
      return {
        success: true,
        newJKF: result.newJkf,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "分岐の削除に失敗",
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
  ): { success: boolean; error?: string; newJKF?: JKFFormat } {
    try {
      const result = JKFEditor.deleteMove(jkf, targetIndex, branchPath);

      if (!result.success) {
        return {
          success: false,
          error: result.error || "手の削除に失敗",
        };
      }

      return {
        success: true,
        newJKF: result.newJkf,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "手の削除に失敗",
      };
    }
  }

  /**
   * 現在の分岐パスの深度を取得
   */
  static getBranchDepth(branchPath: JKFBranchPath): number {
    return branchPath.forkHistory.length;
  }

  /**
   * 分岐パスが有効かどうかをチェック
   */
  static isValidBranchPath(jkf: JKFFormat, branchPath: JKFBranchPath): boolean {
    try {
      return JKFAnalyzer.validateBranchPath(jkf, branchPath);
    } catch {
      return false;
    }
  }

  /**
   * 現在位置から可能な全ての分岐パスを取得
   */
  static getAllBranchPaths(
    jkf: JKFFormat,
    currentIndex: number,
    currentBranchPath: JKFBranchPath,
  ): { success: boolean; error?: string; branchPaths: JKFBranchPath[] } {
    try {
      const branches = JKFAnalyzer.getBranchInfo(jkf, currentIndex);
      const branchPaths: JKFBranchPath[] = [];

      for (const branch of branches) {
        branchPaths.push({
          mainMoveIndex: currentBranchPath.mainMoveIndex,
          forkHistory: [
            ...currentBranchPath.forkHistory,
            { moveIndex: branch.moveIndex, forkIndex: branch.forkIndex },
          ],
        });
      }

      return {
        success: true,
        branchPaths,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "分岐パス一覧の取得に失敗",
        branchPaths: [],
      };
    }
  }

  /**
   * ゲーム終了状態をチェック
   */
  static checkGameEnd(shogiGame: Shogi): {
    isGameEnd: boolean;
    result?: "checkmate" | "stalemate" | "repetition" | "timeup";
    winner?: Color;
  } {
    try {
      const allLegalMoves = LegalMoveGenerator.getAllLegalMoves(
        shogiGame,
        shogiGame.turn,
      );
      // shogi.jsのゲーム終了判定を使用
      if (allLegalMoves.length === 0) {
        const isInCheck = shogiGame.isCheck(shogiGame.turn);

        if (isInCheck) {
          // 王手がかかっていて合法手がない = 詰み
          return {
            isGameEnd: true,
            result: "checkmate",
            winner: shogiGame.turn === Color.Black ? Color.White : Color.Black,
          };
        } else {
          // 王手がかかっていないが合法手がない = ステイルメイト（将棋では通常発生しない）
          return {
            isGameEnd: true,
            result: "stalemate",
          };
        }
      }

      // その他の終了条件もチェック可能
      return { isGameEnd: false };
    } catch (error) {
      console.warn("ゲーム終了判定でエラー:", error);
      return { isGameEnd: false };
    }
  }
}
