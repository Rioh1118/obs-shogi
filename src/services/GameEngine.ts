import { Shogi, type Kind, type IMove } from "shogi.js";
import type { JKFFormat } from "../types/kifu";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { JKFBranchPath } from "../types/game";
import { JKFConverter } from "../utils/JKFConverter";
import { JKFNavigator } from "./JKFNavigator";
import { LegalMoveGenerator } from "./LegalMoveGenerator";
import { JKFAnalyzer } from "./JKFAnalyzer";

export interface GameEngineResult {
  shogi: Shogi;
  lastMove: IMove | null;
  success: boolean;
  error?: string;
}

export class GameEngine {
  /**
   * JKFから将棋エンジンを初期化
   */
  static initializeFromJKF(jkf: JKFFormat): Shogi {
    const shogi = new Shogi();

    if (jkf.initial?.preset === "HIRATE" || !jkf.initial?.data) {
      shogi.initialize();
    } else {
      shogi.initialize();
      // TODO: カスタム局面の実装
      // if (jkf.initial.data) {
      //   this.applyCustomPosition(shogi, jkf.initial.data);
      // }
    }

    return shogi;
  }

  /**
   * 駒種変換（JKF → shogi.js）
   */
  static convertToShogiKind(jkfPiece: string): Kind {
    const validKinds: Kind[] = [
      "FU",
      "KY",
      "KE",
      "GI",
      "KI",
      "KA",
      "HI",
      "OU",
      "TO",
      "NY",
      "NK",
      "NG",
      "UM",
      "RY",
    ];

    if (validKinds.includes(jkfPiece as Kind)) {
      return jkfPiece as Kind;
    }

    throw new Error(`Invalid piece type: ${jkfPiece}`);
  }

  /**
   * 指定インデックスまでメイン分岐の手を適用
   */
  static applyMovesToIndex(
    jkf: JKFFormat,
    targetIndex: number,
  ): GameEngineResult {
    try {
      const shogi = this.initializeFromJKF(jkf);
      let lastMove: IMove | null = null;

      if (!jkf.moves || targetIndex <= 0) {
        return {
          shogi,
          lastMove,
          success: true,
        };
      }

      for (let i = 1; i <= targetIndex && i < jkf.moves.length; i++) {
        const moveElement = jkf.moves[i];

        if (!moveElement.move) {
          // 手以外の要素（コメント、特殊要素など）はスキップ
          continue;
        }

        try {
          const move = JKFConverter.toIMove(moveElement.move);
          const promote = moveElement.move.promote || false;

          if (promote && !LegalMoveGenerator.canPromote(shogi, move)) {
            console.warn("Invalid promotion in JKF");
          }

          const result = this.applyMoveToShogi(shogi, move, promote);

          if (!result.success) {
            return {
              shogi,
              lastMove,
              success: false,
              error: `Failed to apply move at index ${i}: ${result.error}`,
            };
          }

          lastMove = move;
        } catch (error) {
          return {
            shogi,
            lastMove,
            success: false,
            error: `Error processing move at index ${i}: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
      }

      return {
        shogi,
        lastMove,
        success: true,
      };
    } catch (error) {
      return {
        shogi: this.initializeFromJKF(jkf),
        lastMove: null,
        success: false,
        error: `Failed to apply moves: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 分岐パスを考慮して指定インデックスまで手を適用
   */
  static applyMovesToIndexWithBranch(
    jkf: JKFFormat,
    targetIndex: number,
    branchPath: JKFBranchPath,
  ): GameEngineResult {
    try {
      const shogi = this.initializeFromJKF(jkf);
      let lastMove: IMove | null = null;

      if (!jkf.moves || targetIndex <= 0) {
        return {
          shogi,
          lastMove,
          success: true,
        };
      }

      // メイン分岐の手を適用
      // 分岐開始点まではメイン分岐を適用
      const firstFork = branchPath.forkHistory[0];
      const mainEndIndex = firstFork ? firstFork.moveIndex : targetIndex;

      for (
        let i = 1;
        i <= Math.min(mainEndIndex, targetIndex) && i < jkf.moves.length;
        i++
      ) {
        const moveElement = jkf.moves[i];

        if (!moveElement.move) {
          continue;
        }

        try {
          const move = JKFConverter.toIMove(moveElement.move);
          const result = this.applyMoveToShogi(shogi, move);

          if (!result.success) {
            return {
              shogi,
              lastMove,
              success: false,
              error: `Failed to apply main move at index ${i}: ${result.error}`,
            };
          }

          lastMove = move;
        } catch (error) {
          return {
            shogi,
            lastMove,
            success: false,
            error: `Error processing main move at index ${i}: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
      }

      // 分岐の手を適用
      if (branchPath.forkHistory.length > 0 && targetIndex > mainEndIndex) {
        const result = this.applyBranchMoves(
          jkf,
          shogi,
          branchPath,
          targetIndex - mainEndIndex,
          lastMove,
        );

        return result;
      }

      return {
        shogi,
        lastMove,
        success: true,
      };
    } catch (error) {
      return {
        shogi: this.initializeFromJKF(jkf),
        lastMove: null,
        success: false,
        error: `Failed to apply moves with branch: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 分岐の手を適用
   */
  private static applyBranchMoves(
    jkf: JKFFormat,
    shogi: Shogi,
    branchPath: JKFBranchPath,
    remainingMoves: number,
    lastMove: IMove | null,
  ): GameEngineResult {
    try {
      let currentLastMove = lastMove;
      let movesApplied = 0;

      // 分岐履歴を順番に処理
      for (const forkInfo of branchPath.forkHistory) {
        if (movesApplied >= remainingMoves) {
          break;
        }

        // 分岐元の要素を取得
        const parentElement = this.getElementAtIndex(jkf, forkInfo.moveIndex, {
          mainMoveIndex: branchPath.mainMoveIndex,
          forkHistory: branchPath.forkHistory.slice(
            0,
            branchPath.forkHistory.indexOf(forkInfo),
          ),
        });

        if (
          !parentElement ||
          !parentElement.forks ||
          forkInfo.forkIndex >= parentElement.forks.length
        ) {
          return {
            shogi,
            lastMove: currentLastMove,
            success: false,
            error: `Invalid fork reference: moveIndex=${forkInfo.moveIndex}, forkIndex=${forkInfo.forkIndex}`,
          };
        }

        const forkMoves = parentElement.forks[forkInfo.forkIndex];

        // 分岐内の手を適用
        for (
          let i = 0;
          i < forkMoves.length && movesApplied < remainingMoves;
          i++
        ) {
          const moveElement = forkMoves[i];

          if (!moveElement.move) {
            continue;
          }

          try {
            const move = JKFConverter.toIMove(moveElement.move);
            const result = this.applyMoveToShogi(shogi, move);

            if (!result.success) {
              return {
                shogi,
                lastMove: currentLastMove,
                success: false,
                error: `Failed to apply fork move: ${result.error}`,
              };
            }

            currentLastMove = move;
            movesApplied++;
          } catch (error) {
            return {
              shogi,
              lastMove: currentLastMove,
              success: false,
              error: `Error processing fork move: ${error instanceof Error ? error.message : "Unknown error"}`,
            };
          }
        }
      }

      return {
        shogi,
        lastMove: currentLastMove,
        success: true,
      };
    } catch (error) {
      return {
        shogi,
        lastMove,
        success: false,
        error: `Failed to apply branch moves: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 将棋エンジンに手を適用
   */
  static applyMoveToShogi(
    shogi: Shogi,
    move: IMove,
    promote: boolean = false,
  ): { success: boolean; error?: string } {
    try {
      if (move.from) {
        // 盤上の駒を移動 - kind, colorは不要
        console.log("Moving piece on board");
        shogi.move(move.from.x, move.from.y, move.to.x, move.to.y, promote);
      } else {
        // 持ち駒を打つ - kind, colorが必要
        console.log("Dropping piece");

        if (!move.kind || move.color === undefined) {
          return {
            success: false,
            error: "Drop move missing required fields (kind or color)",
          };
        }

        shogi.drop(move.to.x, move.to.y, move.kind, move.color);

        return { success: true };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * 指定位置の要素を取得（分岐パス考慮）
   */
  private static getElementAtIndex(
    jkf: JKFFormat,
    index: number,
    branchPath: JKFBranchPath,
  ): IMoveFormat | null {
    try {
      if (!JKFNavigator.isValidPosition(jkf, index, branchPath)) {
        return null;
      }

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        return jkf.moves?.[index] || null;
      }

      // 分岐内の要素を取得
      const lastFork =
        branchPath.forkHistory[branchPath.forkHistory.length - 1];
      const forkData =
        jkf.moves?.[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];

      return forkData?.[index] || null;
    } catch {
      return null;
    }
  }

  /**
   * 実際の手数を計算（コメントや特殊要素を除く）
   */
  static getActualMoveCount(
    jkf: JKFFormat,
    branchPath?: JKFBranchPath,
  ): number {
    if (!jkf.moves || jkf.moves.length <= 1) {
      return 0;
    }
    // デフォルトのbranchPathを設定
    const defaultBranchPath: JKFBranchPath = branchPath || {
      mainMoveIndex: jkf.moves.length - 1,
      forkHistory: [],
    };

    return JKFAnalyzer.countActualMoves(jkf, defaultBranchPath);
  }

  /**
   * 局面のコピーを作成（SFENを使用）
   */
  static clonePosition(shogi: Shogi): Shogi {
    try {
      const sfen = shogi.toSFENString();
      const newShogi = new Shogi();
      newShogi.initializeFromSFENString(sfen);
      return newShogi;
    } catch (error) {
      // フォールバック: 新しい局面を返す
      const newShogi = new Shogi();
      newShogi.initialize();
      return newShogi;
    }
  }
}
