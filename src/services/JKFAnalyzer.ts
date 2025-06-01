import type { JKFFormat } from "@/types/kifu";
import type { IMove } from "shogi.js";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type {
  JKFMoveElement,
  JKFBranchInfo,
  JKFBranchPath,
  GameProgress,
  BranchNavigationInfo,
} from "@/types/game";
import { JKFConverter } from "../utils/JKFConverter";

export class JKFAnalyzer {
  /**
   * JKF要素の解析 - 純粋に要素の型を判定するだけ
   */
  static parseJKFElement(jkf: JKFFormat, index: number): JKFMoveElement {
    if (!jkf.moves || index < 0 || index >= jkf.moves.length) {
      throw new Error(`Invalid move index: ${index}`);
    }

    const element: IMoveFormat = jkf.moves[index];

    // 空要素の判定（moves[0]など）
    if (!element || Object.keys(element).length === 0) {
      return {
        type: "empty",
        moveIndex: index,
      };
    }

    // 利用可能な分岐を取得
    const availableForks = element.forks
      ? element.forks.map((_, i) => i)
      : undefined;

    // コメントのみの要素
    if (element.comments && !element.move && !element.special) {
      return {
        type: "comment",
        moveIndex: index,
        content: {
          comment: Array.isArray(element.comments)
            ? element.comments.join("\n")
            : element.comments,
        },
        availableForks,
      };
    }

    // 特殊要素（中断、投了など）
    if (element.special) {
      return {
        type: "special",
        moveIndex: index,
        content: {
          special: element.special,
        },
        availableForks,
      };
    }

    // 手の要素
    if (element.move) {
      return {
        type: "move",
        moveIndex: index,
        content: {
          move: JKFConverter.toIMove(element.move), // 適切な変換を使用
          comment: element.comments
            ? Array.isArray(element.comments)
              ? element.comments.join("\n")
              : element.comments
            : undefined,
        },
        availableForks,
      };
    }

    // どれにも該当しない場合は空要素として扱う
    return {
      type: "empty",
      moveIndex: index,
    };
  }

  /**
   * 分岐情報の取得 - 指定位置で利用可能な分岐を抽出
   */
  static getBranchInfo(jkf: JKFFormat, moveIndex: number): JKFBranchInfo[] {
    if (!jkf.moves || moveIndex < 0 || moveIndex >= jkf.moves.length) {
      return [];
    }

    const element: IMoveFormat = jkf.moves[moveIndex];
    if (!element?.forks) {
      return [];
    }

    const branchInfos: JKFBranchInfo[] = [];

    element.forks.forEach((forkData, forkIndex) => {
      branchInfos.push({
        moveIndex,
        forkIndex,
        depth: this.calculateBranchDepth(forkData),
        parentMoveIndex: moveIndex,
      });
    });

    return branchInfos;
  }

  /**
   * 分岐の深さを計算 - 分岐内の要素数をカウント
   */
  private static calculateBranchDepth(forkData: IMoveFormat[]): number {
    return forkData.length;
  }

  /**
   * 実際の手のみを抽出 - IMove形式で返す
   */
  static extractActualMoves(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): IMove[] {
    if (!jkf.moves) {
      return [];
    }

    const moves: IMove[] = [];

    try {
      if (branchPath.forkHistory.length === 0) {
        for (let i = 1; i <= branchPath.mainMoveIndex; i++) {
          const element: IMoveFormat = jkf.moves[i];
          if (element?.move) {
            moves.push(JKFConverter.toIMove(element.move));
          }

          if (element?.special) {
            break;
          }
        }
      } else {
        // 分岐を含む場合
        // メイン分岐の手を追加
        for (let i = 1; i <= branchPath.mainMoveIndex; i++) {
          const element: IMoveFormat = jkf.moves[i];
          if (element?.move) {
            moves.push(JKFConverter.toIMove(element.move));
          }
        }

        // 分岐履歴から手を抽出
        for (const fork of branchPath.forkHistory) {
          const forkMoves = this.extractMovesFromFork(
            jkf,
            fork.moveIndex,
            fork.forkIndex,
          );
          moves.push(...forkMoves);
        }
      }
    } catch (error) {
      console.warn("Error extracting moves from branch path:", error);
    }

    return moves;
  }

  /**
   * 特定の分岐から手を抽出
   */
  private static extractMovesFromFork(
    jkf: JKFFormat,
    moveIndex: number,
    forkIndex: number,
  ): IMove[] {
    if (!jkf.moves?.[moveIndex]?.forks?.[forkIndex]) {
      return [];
    }

    const forkData: IMoveFormat[] = jkf.moves[moveIndex].forks![forkIndex];
    const moves: IMove[] = [];

    // 分岐内の手のみを抽出
    for (const forkElement of forkData) {
      if (forkElement.move) {
        moves.push(JKFConverter.toIMove(forkElement.move));
      }
    }

    return moves;
  }

  /**
   * 分岐パスの妥当性チェック - パスの存在確認のみ
   */
  static validateBranchPath(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): boolean {
    if (!jkf.moves) {
      return false;
    }

    try {
      // メイン分岐の範囲チェック
      if (
        branchPath.mainMoveIndex < 0 ||
        branchPath.mainMoveIndex >= jkf.moves.length
      ) {
        return false;
      }

      // 分岐履歴の妥当性チェック
      for (const fork of branchPath.forkHistory) {
        if (fork.moveIndex < 0 || fork.moveIndex >= jkf.moves.length) {
          return false;
        }

        const element: IMoveFormat = jkf.moves[fork.moveIndex];
        if (!element?.forks?.[fork.forkIndex]) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 進行状況の計算 - JKF構造の解析結果を返す
   */
  static calculateProgress(
    jkf: JKFFormat,
    jkfIndex: number,
    branchPath: JKFBranchPath,
  ): GameProgress {
    const actualMoves = this.extractActualMoves(jkf, branchPath);
    const totalMovesInBranch = this.getTotalMovesInBranch(jkf, branchPath);

    return {
      currentJKFIndex: jkfIndex,
      actualMoveCount: actualMoves.length,
      currentBranchPath: branchPath,
      totalMovesInBranch,
      isAtBranchEnd: this.isAtBranchEnd(jkf, jkfIndex, branchPath),
    };
  }

  /**
   * 分岐内の総手数を計算
   */
  static getTotalMovesInBranch(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): number {
    const allMoves = this.extractActualMoves(jkf, branchPath);
    return allMoves.length;
  }

  /**
   * 分岐の終端かどうかを判定
   */
  private static isAtBranchEnd(
    jkf: JKFFormat,
    jkfIndex: number,
    branchPath: JKFBranchPath,
  ): boolean {
    if (!jkf.moves) return true;

    // 現在の分岐パスでの最後の要素かどうかをチェック
    if (branchPath.forkHistory.length > 0) {
      // 分岐内にいる場合
      const lastFork =
        branchPath.forkHistory[branchPath.forkHistory.length - 1];
      const forkData =
        jkf.moves[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];
      return forkData ? jkfIndex >= forkData.length - 1 : true;
    } else {
      // メイン分岐の場合
      return jkfIndex >= jkf.moves.length - 1;
    }
  }

  /**
   * 分岐ナビゲーション情報の計算
   */
  static calculateBranchNavigation(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): BranchNavigationInfo {
    const availableBranches = this.getAvailableBranches(jkf, branchPath);
    const parentBranch = this.getParentBranch(branchPath);
    const branchDepth = branchPath.forkHistory.length;

    return {
      currentPath: branchPath,
      availableBranches,
      parentBranch,
      branchDepth,
    };
  }

  /**
   * 利用可能な分岐を取得
   */
  private static getAvailableBranches(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): Array<{
    moveIndex: number;
    forkIndex: number;
    previewMove?: IMove;
    comment?: string;
  }> {
    const branches: Array<{
      moveIndex: number;
      forkIndex: number;
      previewMove?: IMove;
      comment?: string;
    }> = [];

    // 現在のパス上の分岐点を探す
    for (let i = 0; i <= branchPath.mainMoveIndex; i++) {
      const branchInfo = this.getBranchInfo(jkf, i);
      for (const info of branchInfo) {
        const forkData = jkf.moves?.[i]?.forks?.[info.forkIndex];
        if (forkData && forkData.length > 0) {
          branches.push({
            moveIndex: i,
            forkIndex: info.forkIndex,
            previewMove: forkData[0]?.move
              ? JKFConverter.toIMove(forkData[0].move)
              : undefined,
            comment: Array.isArray(forkData[0]?.comments)
              ? forkData[0].comments.join("\n")
              : forkData[0]?.comments,
          });
        }
      }
    }

    return branches;
  }

  /**
   * 親分岐を取得
   */
  private static getParentBranch(
    branchPath: JKFBranchPath,
  ): JKFBranchPath | undefined {
    if (branchPath.forkHistory.length === 0) {
      return undefined;
    }

    const parentForkHistory = branchPath.forkHistory.slice(0, -1);
    return {
      mainMoveIndex: branchPath.mainMoveIndex,
      forkHistory: parentForkHistory,
    };
  }

  /**
   * 手数のみを計算（IMove配列を作らずに効率的に）
   */
  static countActualMoves(jkf: JKFFormat, branchPath: JKFBranchPath): number {
    if (!jkf.moves) {
      return 0;
    }

    let count = 0;
    try {
      if (branchPath.forkHistory.length === 0) {
        // メイン分岐のみ
        for (let i = 1; i <= branchPath.mainMoveIndex; i++) {
          const element: IMoveFormat = jkf.moves[i];
          if (element?.move) {
            count++;
          }
          if (element?.special) {
            break;
          }
        }
      } else {
        // 分岐を含む場合
        for (let i = 1; i <= branchPath.mainMoveIndex; i++) {
          const element: IMoveFormat = jkf.moves[i];
          if (element?.move) {
            count++;
          }
        }

        for (const fork of branchPath.forkHistory) {
          count += this.countMovesInFork(jkf, fork.moveIndex, fork.forkIndex);
        }
      }
    } catch (error) {
      console.warn("Error counting moves in branch path:", error);
    }

    return count;
  }

  /**
   * 特定の分岐内の手数をカウント
   */
  private static countMovesInFork(
    jkf: JKFFormat,
    moveIndex: number,
    forkIndex: number,
  ): number {
    if (!jkf.moves?.[moveIndex]?.forks?.[forkIndex]) {
      return 0;
    }

    const forkData: IMoveFormat[] = jkf.moves[moveIndex].forks![forkIndex];
    let count = 0;

    for (const forkElement of forkData) {
      if (forkElement.move) {
        count++;
      }
    }

    return count;
  }
}
