import type { JKFFormat } from "../types/kifu";
import type { IMoveFormat } from "json-kifu-format/dist/src/Formats";
import type {
  JKFBranchPath,
  GameProgress,
  BranchNavigationInfo,
  JKFMoveElement,
} from "../types/game";
import { JKFAnalyzer } from "./JKFAnalyzer";
import { JKFConverter } from "../utils/JKFConverter";

export class JKFNavigator {
  /**
   * 次のJKF要素に移動
   */
  static getNextElement(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    if (!jkf.moves) return null;

    // 分岐内にいる場合
    if (branchPath.forkHistory.length > 0) {
      return this.getNextInBranch(jkf, currentIndex, branchPath);
    }

    // メイン分岐の場合
    const nextIndex = currentIndex + 1;
    if (nextIndex >= jkf.moves.length) {
      return null; // 終端に到達
    }

    try {
      const element = JKFAnalyzer.parseJKFElement(jkf, nextIndex);
      return {
        newIndex: nextIndex,
        newBranchPath: { ...branchPath, mainMoveIndex: nextIndex },
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 前のJKF要素に移動
   */
  static getPreviousElement(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    if (!jkf.moves) return null;

    // 分岐内にいる場合
    if (branchPath.forkHistory.length > 0) {
      return this.getPreviousInBranch(jkf, currentIndex, branchPath);
    }

    // メイン分岐の場合
    const prevIndex = currentIndex - 1;

    if (prevIndex < 0) {
      return null; // 開始位置に到達
    }

    try {
      const element = JKFAnalyzer.parseJKFElement(jkf, prevIndex);
      return {
        newIndex: prevIndex,
        newBranchPath: { ...branchPath, mainMoveIndex: prevIndex },
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 次の実際の手に移動（コメントや特殊要素をスキップ）
   */
  static getNextMove(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement;
  } | null {
    let searchIndex = currentIndex;
    let searchPath = { ...branchPath };

    while (true) {
      const next = this.getNextElement(jkf, searchIndex, searchPath);
      if (!next || !next.element) {
        return null;
      }

      if (next.element.type === "move") {
        return {
          newIndex: next.newIndex,
          newBranchPath: next.newBranchPath,
          element: next.element,
        };
      }

      searchIndex = next.newIndex;
      searchPath = next.newBranchPath;
    }
  }

  /**
   * 前の実際の手に移動（コメントや特殊要素をスキップ）
   */
  static getPreviousMove(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement;
  } | null {
    let searchIndex = currentIndex;
    let searchPath = { ...branchPath };

    while (true) {
      const prev = this.getPreviousElement(jkf, searchIndex, searchPath);
      if (!prev || !prev.element) {
        return null;
      }

      if (prev.element.type === "move") {
        return {
          newIndex: prev.newIndex,
          newBranchPath: prev.newBranchPath,
          element: prev.element,
        };
      }

      searchIndex = prev.newIndex;
      searchPath = prev.newBranchPath;
    }
  }

  /**
   * 開始位置に移動
   */
  static goToStart(jkf: JKFFormat): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    if (!jkf.moves || jkf.moves.length === 0) return null;

    const startPath: JKFBranchPath = {
      mainMoveIndex: 0,
      forkHistory: [],
    };

    try {
      const element = JKFAnalyzer.parseJKFElement(jkf, 0);
      return {
        newIndex: 0,
        newBranchPath: startPath,
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 終了位置に移動
   */
  static goToEnd(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    if (!jkf.moves) return null;

    // 分岐内にいる場合は分岐の終端へ
    if (branchPath.forkHistory.length > 0) {
      return this.goToEndOfBranch(jkf, branchPath);
    }

    // メイン分岐の終端へ
    const endIndex = jkf.moves.length - 1;
    const endPath: JKFBranchPath = {
      mainMoveIndex: endIndex,
      forkHistory: [],
    };

    try {
      const element = JKFAnalyzer.parseJKFElement(jkf, endIndex);
      return {
        newIndex: endIndex,
        newBranchPath: endPath,
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 指定した既存分岐に移動
   */
  static switchToBranch(
    jkf: JKFFormat,
    targetBranchPath: JKFBranchPath,
    targetIndex?: number,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    if (!JKFAnalyzer.validateBranchPath(jkf, targetBranchPath)) {
      return null;
    }

    // インデックスが指定されていない場合は分岐の開始位置
    const index = targetIndex ?? this.getBranchStartIndex(targetBranchPath);

    try {
      const element = this.getElementInBranch(jkf, index, targetBranchPath);
      return {
        newIndex: index,
        newBranchPath: targetBranchPath,
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 親分岐に戻る
   */
  static goToParentBranch(
    jkf: JKFFormat,
    currentBranchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    if (currentBranchPath.forkHistory.length === 0) {
      return null; // すでにメイン分岐
    }

    const parentPath: JKFBranchPath = {
      mainMoveIndex: currentBranchPath.mainMoveIndex,
      forkHistory: currentBranchPath.forkHistory.slice(0, -1),
    };

    const lastFork =
      currentBranchPath.forkHistory[currentBranchPath.forkHistory.length - 1];

    try {
      const element = this.getElementInBranch(
        jkf,
        lastFork.moveIndex,
        parentPath,
      );
      return {
        newIndex: lastFork.moveIndex,
        newBranchPath: parentPath,
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 現在位置から利用可能な分岐を取得（読み取り専用）
   */
  static getAvailableBranchesAtPosition(
    jkf: JKFFormat,
    index: number,
    branchPath: JKFBranchPath,
  ): Array<{
    moveIndex: number;
    forkIndex: number;
    previewElement?: JKFMoveElement;
  }> {
    const branches: Array<{
      moveIndex: number;
      forkIndex: number;
      previewElement?: JKFMoveElement;
    }> = [];

    try {
      let element: IMoveFormat | undefined;

      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        element = jkf.moves?.[index];
      } else {
        // 分岐内
        const lastFork =
          branchPath.forkHistory[branchPath.forkHistory.length - 1];
        const forkData =
          jkf.moves?.[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];
        element = forkData?.[index];
      }

      if (element?.forks) {
        element.forks.forEach((forkData, forkIndex) => {
          // 分岐の最初の要素をプレビューとして取得
          let previewElement: JKFMoveElement | undefined;
          if (forkData.length > 0) {
            try {
              previewElement = this.parseElementInFork(forkData[0], 0);
            } catch {
              // プレビュー取得に失敗しても分岐情報は返す
            }
          }

          branches.push({
            moveIndex: index,
            forkIndex,
            previewElement,
          });
        });
      }
    } catch (error) {
      console.warn("Error getting available branches:", error);
    }

    return branches;
  }

  /**
   * 進行状況とナビゲーション情報を更新
   */
  static updateNavigationInfo(
    jkf: JKFFormat,
    jkfIndex: number,
    branchPath: JKFBranchPath,
  ): {
    progress: GameProgress;
    branchNavigation: BranchNavigationInfo;
  } {
    const progress = JKFAnalyzer.calculateProgress(jkf, jkfIndex, branchPath);
    const branchNavigation = JKFAnalyzer.calculateBranchNavigation(
      jkf,
      branchPath,
    );

    return {
      progress,
      branchNavigation,
    };
  }

  /**
   * 指定位置が有効かチェック
   */
  static isValidPosition(
    jkf: JKFFormat,
    index: number,
    branchPath: JKFBranchPath,
  ): boolean {
    if (!jkf.moves) return false;

    try {
      if (branchPath.forkHistory.length === 0) {
        // メイン分岐
        return index >= 0 && index < jkf.moves.length;
      } else {
        // 分岐内
        const lastFork =
          branchPath.forkHistory[branchPath.forkHistory.length - 1];
        const forkData =
          jkf.moves[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];
        return forkData ? index >= 0 && index < forkData.length : false;
      }
    } catch {
      return false;
    }
  }

  /**
   * 分岐の深度を計算
   */
  static calculateBranchDepth(branchPath: JKFBranchPath): number {
    return branchPath.forkHistory.length;
  }

  /**
   * 分岐パスの文字列表現を生成（デバッグ用）
   */
  static branchPathToString(branchPath: JKFBranchPath): string {
    const main = `main:${branchPath.mainMoveIndex}`;
    const forks = branchPath.forkHistory
      .map((fork) => `${fork.moveIndex}-${fork.forkIndex}`)
      .join(",");

    return forks ? `${main}[${forks}]` : main;
  }

  /**
   * 文字列から分岐パスを復元（デバッグ用）
   */
  static stringToBranchPath(pathString: string): JKFBranchPath | null {
    try {
      const match = pathString.match(/^main:(\d+)(?:\[([^\]]+)\])?$/);
      if (!match) return null;

      const mainMoveIndex = parseInt(match[1], 10);
      const forkHistory: Array<{ moveIndex: number; forkIndex: number }> = [];

      if (match[2]) {
        const forkParts = match[2].split(",");
        for (const part of forkParts) {
          const [moveIndex, forkIndex] = part
            .split("-")
            .map((n) => parseInt(n, 10));
          if (!isNaN(moveIndex) && !isNaN(forkIndex)) {
            forkHistory.push({ moveIndex, forkIndex });
          }
        }
      }

      return {
        mainMoveIndex,
        forkHistory,
      };
    } catch {
      return null;
    }
  }

  // ===== Private Methods =====

  /**
   * 分岐内での次の要素を取得
   */
  private static getNextInBranch(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    const lastFork = branchPath.forkHistory[branchPath.forkHistory.length - 1];
    const forkData =
      jkf.moves?.[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];

    if (!forkData) return null;

    const nextIndex = currentIndex + 1;
    if (nextIndex >= forkData.length) {
      // 分岐の終端に到達、親分岐に戻る
      return this.goToParentBranch(jkf, branchPath);
    }

    try {
      const element = this.parseElementInFork(forkData[nextIndex], nextIndex);
      return {
        newIndex: nextIndex,
        newBranchPath: branchPath,
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 分岐内での前の要素を取得
   */
  private static getPreviousInBranch(
    jkf: JKFFormat,
    currentIndex: number,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    const prevIndex = currentIndex - 1;

    if (prevIndex < 0) {
      // 分岐の開始に到達、親分岐に戻る
      return this.goToParentBranch(jkf, branchPath);
    }

    const lastFork = branchPath.forkHistory[branchPath.forkHistory.length - 1];
    const forkData =
      jkf.moves?.[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];

    if (!forkData || prevIndex >= forkData.length) return null;

    try {
      const element = this.parseElementInFork(forkData[prevIndex], prevIndex);
      return {
        newIndex: prevIndex,
        newBranchPath: branchPath,
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 分岐の終端に移動
   */
  private static goToEndOfBranch(
    jkf: JKFFormat,
    branchPath: JKFBranchPath,
  ): {
    newIndex: number;
    newBranchPath: JKFBranchPath;
    element: JKFMoveElement | null;
  } | null {
    const lastFork = branchPath.forkHistory[branchPath.forkHistory.length - 1];
    const forkData =
      jkf.moves?.[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];

    if (!forkData || forkData.length === 0) return null;

    const endIndex = forkData.length - 1;

    try {
      const element = this.parseElementInFork(forkData[endIndex], endIndex);
      return {
        newIndex: endIndex,
        newBranchPath: branchPath,
        element,
      };
    } catch {
      return null;
    }
  }

  /**
   * 分岐の開始インデックスを取得
   */
  private static getBranchStartIndex(branchPath: JKFBranchPath): number {
    return branchPath.forkHistory.length > 0 ? 0 : branchPath.mainMoveIndex;
  }

  /**
   * 分岐内の要素を取得
   */
  private static getElementInBranch(
    jkf: JKFFormat,
    index: number,
    branchPath: JKFBranchPath,
  ): JKFMoveElement | null {
    if (branchPath.forkHistory.length === 0) {
      // メイン分岐
      return JKFAnalyzer.parseJKFElement(jkf, index);
    }

    // 分岐内
    const lastFork = branchPath.forkHistory[branchPath.forkHistory.length - 1];
    const forkData =
      jkf.moves?.[lastFork.moveIndex]?.forks?.[lastFork.forkIndex];

    if (!forkData || index >= forkData.length) return null;

    return this.parseElementInFork(forkData[index], index);
  }

  /**
   * 分岐内の要素をパース
   */
  private static parseElementInFork(
    element: IMoveFormat,
    index: number,
  ): JKFMoveElement {
    if (!element || Object.keys(element).length === 0) {
      return {
        type: "empty",
        moveIndex: index,
      };
    }

    const availableForks = element.forks
      ? element.forks.map((_, i) => i)
      : undefined;

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

    if (element.move) {
      return {
        type: "move",
        moveIndex: index,
        content: {
          move: JKFConverter.toIMove(element.move),
          comment: element.comments
            ? Array.isArray(element.comments)
              ? element.comments.join("\n")
              : element.comments
            : undefined,
        },
        availableForks,
      };
    }

    return {
      type: "empty",
      moveIndex: index,
    };
  }
}
