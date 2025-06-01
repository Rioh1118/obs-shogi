import type { JKFFormat } from "../types/kifu";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { IMove } from "shogi.js";
import type { JKFBranchPath } from "../types/game";
import { JKFConverter } from "../utils/JKFConverter";

export interface EditResult {
  success: boolean;
  newJkf?: JKFFormat;
  newBranchPath?: JKFBranchPath;
  newIndex?: number;
  error?: string;
}

export interface BranchCreationResult extends EditResult {
  forkIndex?: number;
}

export class JKFEditor {
  /**
   * 指定位置に新しい手を追加
   */
  static addMove(
    jkf: JKFFormat,
    move: IMove,
    insertIndex: number,
    branchPath: JKFBranchPath,
    comment?: string,
  ): EditResult {
    try {
      const newJkf = this.deepCloneJKF(jkf);

      if (!newJkf.moves) {
        newJkf.moves = [];
      }

      const moveElement: IMoveFormat = {
        move: JKFConverter.toJKFMove(move), // fromIMove → toJKFMove
      };

      if (comment) {
        moveElement.comments = [comment]; // string → string[]
      }

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐に追加
        newJkf.moves.splice(insertIndex, 0, moveElement);

        return {
          success: true,
          newJkf,
          newBranchPath: {
            ...branchPath,
            mainMoveIndex: insertIndex,
          },
          newIndex: insertIndex,
        };
      } else {
        // 分岐内に追加
        const result = this.addMoveToFork(
          newJkf,
          moveElement,
          insertIndex,
          branchPath,
        );
        if (!result.success) {
          return result;
        }

        return {
          success: true,
          newJkf,
          newBranchPath: branchPath,
          newIndex: insertIndex,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to add move: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 特殊要素を追加
   */
  static insertSpecial(
    jkf: JKFFormat,
    special: string,
    insertIndex: number,
    branchPath: JKFBranchPath,
  ): EditResult {
    try {
      const newJkf = this.deepCloneJKF(jkf);
      if (!newJkf.moves) {
        newJkf.moves = [];
      }

      const specialElement: IMoveFormat = {
        special: special,
      };

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐に追加
        newJkf.moves.splice(insertIndex, 0, specialElement);
        return {
          success: true,
          newJkf,
          newBranchPath: {
            ...branchPath,
            mainMoveIndex: insertIndex,
          },
          newIndex: insertIndex,
        };
      } else {
        // 分岐内に追加
        const result = this.addMoveToFork(
          newJkf,
          specialElement,
          insertIndex,
          branchPath,
        );
        if (!result.success) {
          return result;
        }
        return {
          success: true,
          newJkf,
          newBranchPath: branchPath,
          newIndex: insertIndex,
        };
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to insert special: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 新しい分岐を作成
   */
  static createBranch(
    jkf: JKFFormat,
    branchFromIndex: number,
    branchPath: JKFBranchPath,
    initialMove?: IMove,
    comment?: string,
  ): BranchCreationResult {
    try {
      const newJkf = this.deepCloneJKF(jkf);

      if (!newJkf.moves) {
        return {
          success: false,
          error: "No moves array in JKF",
        };
      }

      // 分岐元の要素を取得
      let targetElement: IMoveFormat;

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐から分岐
        if (branchFromIndex >= newJkf.moves.length) {
          return {
            success: false,
            error: "Invalid branch index",
          };
        }
        targetElement = newJkf.moves[branchFromIndex];
      } else {
        // 分岐内から分岐
        const result = this.getElementInFork(
          newJkf,
          branchFromIndex,
          branchPath,
        );
        if (!result.success || !result.element) {
          return {
            success: false,
            error: "Failed to get fork element",
          };
        }
        targetElement = result.element;
      }

      // forks配列を初期化（存在しない場合）
      if (!targetElement.forks) {
        targetElement.forks = [];
      }

      // 新しい分岐を作成
      const newFork: IMoveFormat[] = [];

      if (initialMove) {
        const moveElement: IMoveFormat = {
          move: JKFConverter.toJKFMove(initialMove), // fromIMove → toJKFMove
        };

        if (comment) {
          moveElement.comments = [comment]; // string → string[]
        }

        newFork.push(moveElement);
      }

      targetElement.forks.push(newFork);
      const forkIndex = targetElement.forks.length - 1;

      // 新しい分岐パスを生成
      const newBranchPath: JKFBranchPath = {
        mainMoveIndex: branchPath.mainMoveIndex,
        forkHistory: [
          ...branchPath.forkHistory,
          {
            moveIndex: branchFromIndex,
            forkIndex,
          },
        ],
      };

      return {
        success: true,
        newJkf,
        newBranchPath,
        newIndex: initialMove ? 0 : -1,
        forkIndex,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create branch: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 手を削除
   */
  static deleteMove(
    jkf: JKFFormat,
    deleteIndex: number,
    branchPath: JKFBranchPath,
  ): EditResult {
    try {
      const newJkf = this.deepCloneJKF(jkf);

      if (!newJkf.moves) {
        return {
          success: false,
          error: "No moves array in JKF",
        };
      }

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐から削除
        if (deleteIndex >= newJkf.moves.length || deleteIndex < 0) {
          return {
            success: false,
            error: "Invalid delete index",
          };
        }

        newJkf.moves.splice(deleteIndex, 1);

        // インデックスを調整
        const newIndex = Math.min(deleteIndex, newJkf.moves.length - 1);

        return {
          success: true,
          newJkf,
          newBranchPath: {
            ...branchPath,
            mainMoveIndex: Math.max(0, newIndex),
          },
          newIndex: Math.max(0, newIndex),
        };
      } else {
        // 分岐内から削除
        const result = this.deleteMoveFromFork(newJkf, deleteIndex, branchPath);
        return result;
      }
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete move: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 分岐を削除
   */
  static deleteBranch(jkf: JKFFormat, branchPath: JKFBranchPath): EditResult {
    try {
      if (branchPath.forkHistory.length === 0) {
        return {
          success: false,
          error: "Cannot delete main branch",
        };
      }

      const newJkf = this.deepCloneJKF(jkf);
      const lastFork =
        branchPath.forkHistory[branchPath.forkHistory.length - 1];

      // 親分岐の要素を取得
      const parentBranchPath: JKFBranchPath = {
        mainMoveIndex: branchPath.mainMoveIndex,
        forkHistory: branchPath.forkHistory.slice(0, -1),
      };

      let targetElement: IMoveFormat;

      if (parentBranchPath.forkHistory.length === 0) {
        // メイン分岐の要素
        if (!newJkf.moves || lastFork.moveIndex >= newJkf.moves.length) {
          return {
            success: false,
            error: "Invalid parent element",
          };
        }
        targetElement = newJkf.moves[lastFork.moveIndex];
      } else {
        // 分岐内の要素
        const result = this.getElementInFork(
          newJkf,
          lastFork.moveIndex,
          parentBranchPath,
        );
        if (!result.success || !result.element) {
          return {
            success: false,
            error: "Failed to get parent element",
          };
        }
        targetElement = result.element;
      }

      if (
        !targetElement.forks ||
        lastFork.forkIndex >= targetElement.forks.length
      ) {
        return {
          success: false,
          error: "Invalid fork index",
        };
      }

      // 分岐を削除
      targetElement.forks.splice(lastFork.forkIndex, 1);

      // forks配列が空になった場合は削除
      if (targetElement.forks.length === 0) {
        delete targetElement.forks;
      }

      return {
        success: true,
        newJkf,
        newBranchPath: parentBranchPath,
        newIndex: lastFork.moveIndex,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to delete branch: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
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
    try {
      const newJkf = this.deepCloneJKF(jkf);

      if (!newJkf.moves) {
        return {
          success: false,
          error: "No moves array in JKF",
        };
      }

      let targetElement: IMoveFormat;

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        if (targetIndex >= newJkf.moves.length || targetIndex < 0) {
          return {
            success: false,
            error: "Invalid target index",
          };
        }
        targetElement = newJkf.moves[targetIndex];
      } else {
        // 分岐内
        const result = this.getElementInFork(newJkf, targetIndex, branchPath);
        if (!result.success || !result.element) {
          return {
            success: false,
            error: "Failed to get target element",
          };
        }
        targetElement = result.element;
      }

      // コメントを設定
      if (comment.trim()) {
        targetElement.comments = [comment]; // string → string[]
      } else {
        delete targetElement.comments;
      }

      return {
        success: true,
        newJkf,
        newBranchPath: branchPath,
        newIndex: targetIndex,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to edit comment: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 手を変更
   */
  static editMove(
    jkf: JKFFormat,
    targetIndex: number,
    branchPath: JKFBranchPath,
    newMove: IMove,
  ): EditResult {
    try {
      const newJkf = this.deepCloneJKF(jkf);

      if (!newJkf.moves) {
        return {
          success: false,
          error: "No moves array in JKF",
        };
      }

      let targetElement: IMoveFormat;

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        if (targetIndex >= newJkf.moves.length || targetIndex < 0) {
          return {
            success: false,
            error: "Invalid target index",
          };
        }
        targetElement = newJkf.moves[targetIndex];
      } else {
        // 分岐内
        const result = this.getElementInFork(newJkf, targetIndex, branchPath);
        if (!result.success || !result.element) {
          return {
            success: false,
            error: "Failed to get target element",
          };
        }
        targetElement = result.element;
      }

      // 手を変更
      targetElement.move = JKFConverter.toJKFMove(newMove); // fromIMove → toJKFMove

      return {
        success: true,
        newJkf,
        newBranchPath: branchPath,
        newIndex: targetIndex,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to edit move: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 変化を本譜に昇格
   */
  static promoteVariation(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): EditResult {
    try {
      if (branchPath.forkHistory.length === 0) {
        return {
          success: false,
          error: "Already in main branch",
        };
      }

      const newJkf = this.deepCloneJKF(jkf);
      const lastFork =
        branchPath.forkHistory[branchPath.forkHistory.length - 1];

      // 分岐データを取得
      const parentBranchPath: JKFBranchPath = {
        mainMoveIndex: branchPath.mainMoveIndex,
        forkHistory: branchPath.forkHistory.slice(0, -1),
      };

      let parentElement: IMoveFormat;

      if (parentBranchPath.forkHistory.length === 0) {
        // メイン分岐の要素
        if (!newJkf.moves || lastFork.moveIndex >= newJkf.moves.length) {
          return {
            success: false,
            error: "Invalid parent element",
          };
        }
        parentElement = newJkf.moves[lastFork.moveIndex];
      } else {
        // 分岐内の要素
        const result = this.getElementInFork(
          newJkf,
          lastFork.moveIndex,
          parentBranchPath,
        );
        if (!result.success || !result.element) {
          return {
            success: false,
            error: "Failed to get parent element",
          };
        }
        parentElement = result.element;
      }

      if (
        !parentElement.forks ||
        lastFork.forkIndex >= parentElement.forks.length
      ) {
        return {
          success: false,
          error: "Invalid fork index",
        };
      }

      const targetFork = parentElement.forks[lastFork.forkIndex];

      // 現在の本譜を分岐に移動
      const currentMainMoves =
        parentBranchPath.forkHistory.length === 0
          ? newJkf.moves!.slice(lastFork.moveIndex + 1)
          : this.getRestOfFork(newJkf, lastFork.moveIndex, parentBranchPath);

      if (!currentMainMoves) {
        return {
          success: false,
          error: "Failed to get current main moves",
        };
      }

      // 分岐を本譜に昇格
      if (parentBranchPath.forkHistory.length === 0) {
        // メイン分岐での昇格
        newJkf.moves!.splice(
          lastFork.moveIndex + 1,
          currentMainMoves.length,
          ...targetFork,
        );

        // 元の本譜を分岐として保存
        if (currentMainMoves.length > 0) {
          parentElement.forks[lastFork.forkIndex] = currentMainMoves;
        } else {
          parentElement.forks.splice(lastFork.forkIndex, 1);
          if (parentElement.forks.length === 0) {
            delete parentElement.forks;
          }
        }
      } else {
        // 分岐内での昇格
        const result = this.replaceInFork(
          newJkf,
          lastFork.moveIndex,
          parentBranchPath,
          targetFork,
        );
        if (!result.success) {
          return result;
        }

        // 元の分岐を置き換え
        if (currentMainMoves.length > 0) {
          parentElement.forks[lastFork.forkIndex] = currentMainMoves;
        } else {
          parentElement.forks.splice(lastFork.forkIndex, 1);
          if (parentElement.forks.length === 0) {
            delete parentElement.forks;
          }
        }
      }

      return {
        success: true,
        newJkf,
        newBranchPath: parentBranchPath,
        newIndex: lastFork.moveIndex,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to promote variation: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 新しい分岐パスを生成
   */
  static createNewBranchPath(
    currentPath: JKFBranchPath,
    branchMoveIndex: number,
    forkIndex: number,
  ): JKFBranchPath {
    return {
      mainMoveIndex: currentPath.mainMoveIndex,
      forkHistory: [
        ...currentPath.forkHistory,
        {
          moveIndex: branchMoveIndex,
          forkIndex,
        },
      ],
    };
  }

  // ===== Private Helper Methods =====

  /**
   * JKFの深いクローンを作成
   */
  private static deepCloneJKF(jkf: JKFFormat): JKFFormat {
    return JSON.parse(JSON.stringify(jkf));
  }

  /**
   * 分岐内に手を追加
   */
  private static addMoveToFork(
    jkf: JKFFormat,
    moveElement: IMoveFormat,
    insertIndex: number,
    branchPath: JKFBranchPath,
  ): EditResult {
    const lastFork = branchPath.forkHistory[branchPath.forkHistory.length - 1];

    // 親分岐の要素を取得
    const parentBranchPath: JKFBranchPath = {
      mainMoveIndex: branchPath.mainMoveIndex,
      forkHistory: branchPath.forkHistory.slice(0, -1),
    };

    let parentElement: IMoveFormat;

    if (parentBranchPath.forkHistory.length === 0) {
      // メイン分岐の要素
      if (!jkf.moves || lastFork.moveIndex >= jkf.moves.length) {
        return {
          success: false,
          error: "Invalid parent element",
        };
      }
      parentElement = jkf.moves[lastFork.moveIndex];
    } else {
      // 分岐内の要素
      const result = this.getElementInFork(
        jkf,
        lastFork.moveIndex,
        parentBranchPath,
      );
      if (!result.success || !result.element) {
        return {
          success: false,
          error: "Failed to get parent element",
        };
      }
      parentElement = result.element;
    }

    if (
      !parentElement.forks ||
      lastFork.forkIndex >= parentElement.forks.length
    ) {
      return {
        success: false,
        error: "Invalid fork index",
      };
    }

    const targetFork = parentElement.forks[lastFork.forkIndex];
    targetFork.splice(insertIndex, 0, moveElement);

    return { success: true };
  }

  /**
   * 分岐内から手を削除
   */
  private static deleteMoveFromFork(
    jkf: JKFFormat,
    deleteIndex: number,
    branchPath: JKFBranchPath,
  ): EditResult {
    const lastFork = branchPath.forkHistory[branchPath.forkHistory.length - 1];

    // 親分岐の要素を取得
    const parentBranchPath: JKFBranchPath = {
      mainMoveIndex: branchPath.mainMoveIndex,
      forkHistory: branchPath.forkHistory.slice(0, -1),
    };

    let parentElement: IMoveFormat;

    if (parentBranchPath.forkHistory.length === 0) {
      // メイン分岐の要素
      if (!jkf.moves || lastFork.moveIndex >= jkf.moves.length) {
        return {
          success: false,
          error: "Invalid parent element",
        };
      }
      parentElement = jkf.moves[lastFork.moveIndex];
    } else {
      // 分岐内の要素
      const result = this.getElementInFork(
        jkf,
        lastFork.moveIndex,
        parentBranchPath,
      );
      if (!result.success || !result.element) {
        return {
          success: false,
          error: "Failed to get parent element",
        };
      }
      parentElement = result.element;
    }

    if (
      !parentElement.forks ||
      lastFork.forkIndex >= parentElement.forks.length
    ) {
      return {
        success: false,
        error: "Invalid fork index",
      };
    }

    const targetFork = parentElement.forks[lastFork.forkIndex];

    if (deleteIndex >= targetFork.length || deleteIndex < 0) {
      return {
        success: false,
        error: "Invalid delete index in fork",
      };
    }

    targetFork.splice(deleteIndex, 1);

    // 分岐が空になった場合は分岐自体を削除
    if (targetFork.length === 0) {
      parentElement.forks.splice(lastFork.forkIndex, 1);
      if (parentElement.forks.length === 0) {
        delete parentElement.forks;
      }

      // 親分岐に戻る
      return {
        success: true,
        newBranchPath: parentBranchPath,
        newIndex: lastFork.moveIndex,
      };
    }

    // インデックスを調整
    const newIndex = Math.min(deleteIndex, targetFork.length - 1);

    return {
      success: true,
      newBranchPath: branchPath,
      newIndex: Math.max(0, newIndex),
    };
  }

  /**
   * 分岐内の要素を取得
   */
  private static getElementInFork(
    jkf: JKFFormat,
    index: number,
    branchPath: JKFBranchPath,
  ): { success: boolean; element?: IMoveFormat; error?: string } {
    try {
      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        if (!jkf.moves || index >= jkf.moves.length || index < 0) {
          return {
            success: false,
            error: "Invalid index in main branch",
          };
        }
        return {
          success: true,
          element: jkf.moves[index],
        };
      }

      // 分岐内
      const lastFork =
        branchPath.forkHistory[branchPath.forkHistory.length - 1];
      const parentResult = this.getElementInFork(jkf, lastFork.moveIndex, {
        mainMoveIndex: branchPath.mainMoveIndex,
        forkHistory: branchPath.forkHistory.slice(0, -1),
      });

      if (!parentResult.success || !parentResult.element) {
        return parentResult;
      }

      const forkData = parentResult.element.forks?.[lastFork.forkIndex];
      if (!forkData || index >= forkData.length || index < 0) {
        return {
          success: false,
          error: "Invalid index in fork",
        };
      }

      return {
        success: true,
        element: forkData[index],
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get element in fork: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * 分岐の残りの手を取得
   */
  private static getRestOfFork(
    jkf: JKFFormat,
    fromIndex: number,
    branchPath: JKFBranchPath,
  ): IMoveFormat[] | null {
    try {
      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        if (!jkf.moves || fromIndex >= jkf.moves.length) {
          return [];
        }
        return jkf.moves.slice(fromIndex + 1);
      }

      // 分岐内
      const lastFork =
        branchPath.forkHistory[branchPath.forkHistory.length - 1];
      const parentResult = this.getElementInFork(jkf, lastFork.moveIndex, {
        mainMoveIndex: branchPath.mainMoveIndex,
        forkHistory: branchPath.forkHistory.slice(0, -1),
      });

      if (!parentResult.success || !parentResult.element) {
        return null;
      }

      const forkData = parentResult.element.forks?.[lastFork.forkIndex];
      if (!forkData || fromIndex >= forkData.length) {
        return [];
      }

      return forkData.slice(fromIndex + 1);
    } catch {
      return null;
    }
  }

  /**
   * 分岐内の手を置き換え
   */
  private static replaceInFork(
    jkf: JKFFormat,
    fromIndex: number,
    branchPath: JKFBranchPath,
    newMoves: IMoveFormat[],
  ): EditResult {
    try {
      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        if (!jkf.moves || fromIndex >= jkf.moves.length) {
          return {
            success: false,
            error: "Invalid index in main branch",
          };
        }

        const deleteCount = jkf.moves.length - fromIndex - 1;
        jkf.moves.splice(fromIndex + 1, deleteCount, ...newMoves);

        return { success: true };
      }

      // 分岐内
      const lastFork =
        branchPath.forkHistory[branchPath.forkHistory.length - 1];
      const parentResult = this.getElementInFork(jkf, lastFork.moveIndex, {
        mainMoveIndex: branchPath.mainMoveIndex,
        forkHistory: branchPath.forkHistory.slice(0, -1),
      });

      if (!parentResult.success || !parentResult.element) {
        return {
          success: false,
          error: "Failed to get parent element",
        };
      }

      const forkData = parentResult.element.forks?.[lastFork.forkIndex];
      if (!forkData || fromIndex >= forkData.length) {
        return {
          success: false,
          error: "Invalid index in fork",
        };
      }

      const deleteCount = forkData.length - fromIndex - 1;
      forkData.splice(fromIndex + 1, deleteCount, ...newMoves);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `Failed to replace in fork: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }
}
