import type { JKFEditor } from "@/interfaces";
import {
  type JKFData,
  type ShogiMove,
  type JKFBranchPath,
  type Result,
  Err,
  Ok,
} from "@/types";
import {
  convertShogiMoveToJKF,
  type MoveConvertOptions,
} from "@/adapter/moveConverter";
import {
  getCurrentBranchMoves,
  isAtBranchEnd,
  isValidBranchPath,
} from "./branch";

export class JKFEditorImpl implements JKFEditor {
  addMove(
    jkf: JKFData,
    move: ShogiMove,
    currentBranchPath: JKFBranchPath,
    currentMoveIndex: number,
    options?: MoveConvertOptions,
  ): Result<
    {
      newJKF: JKFData;
      resultBranchPath: JKFBranchPath;
      wasNewBranchCreated: boolean;
    },
    string
  > {
    try {
      // 1. ブランチパスの妥当性チェック
      if (!isValidBranchPath(jkf, currentBranchPath)) {
        return Err("Invalid branch path");
      }

      // 2. 現在位置がブランチの終端かチェック
      if (isAtBranchEnd(jkf, currentBranchPath, currentMoveIndex)) {
        // 終端の場合は既存ブランチに追加
        const result = this.appendMoveToCurrentBranch(
          jkf,
          move,
          currentBranchPath,
          options,
        );
        if (!result.success) {
          return Err(result.error);
        }

        return Ok({
          newJKF: result.data,
          resultBranchPath: currentBranchPath,
          wasNewBranchCreated: false,
        });
      } else {
        // 終端でない場合は新しい分岐を作成
        const result = this.createNewForkWithMove(
          jkf,
          move,
          currentMoveIndex,
          currentBranchPath,
          options,
        );
        if (!result.success) {
          return Err(result.error);
        }

        return Ok({
          newJKF: result.data.newJKF,
          resultBranchPath: result.data.newBranchPath,
          wasNewBranchCreated: true,
        });
      }
    } catch (error) {
      return Err(
        `Failed to add move: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // === 既存ブランチに手を追加 ===
  appendMoveToCurrentBranch(
    jkf: JKFData,
    move: ShogiMove,
    branchPath: JKFBranchPath,
    options?: MoveConvertOptions,
  ): Result<JKFData, string> {
    try {
      // 1. JKFDataを深いコピー
      const newJKF = structuredClone(jkf);

      // 2. 現在のブランチの手順配列を取得
      const currentBranchMoves = getCurrentBranchMoves(newJKF, branchPath);

      // 3. ShogiMoveをJKFMoveに変換
      const jkfMove = convertShogiMoveToJKF(move, options);
      currentBranchMoves.push(jkfMove);

      return Ok(newJKF);
    } catch (error) {
      return Err(
        `Failed to append move: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // === 新しい分岐を作成 ===
  createNewForkWithMove(
    jkf: JKFData,
    move: ShogiMove,
    baseMoveIndex: number,
    baseBranchPath: JKFBranchPath,
    options?: MoveConvertOptions,
  ): Result<
    {
      newJKF: JKFData;
      newBranchPath: JKFBranchPath;
    },
    string
  > {
    try {
      // 1. JKFDataを深いコピー
      const newJKF = structuredClone(jkf);

      // 2. 対象の手を取得
      const currentBranchMoves = getCurrentBranchMoves(newJKF, baseBranchPath);
      if (baseMoveIndex >= currentBranchMoves.length) {
        return Err("Invalid base move index");
      }

      const targetMove = currentBranchMoves[baseMoveIndex];

      // 3. forksがない場合は初期化
      if (!targetMove.forks) {
        targetMove.forks = [];
      }

      // 4. 新しい分岐を作成
      const jkfMove = convertShogiMoveToJKF(move, options);
      const newFork = [jkfMove];
      targetMove.forks.push(newFork);

      // 5. 新しいブランチパスを作成
      const newBranchPath: JKFBranchPath = {
        mainMoveIndex: baseBranchPath.mainMoveIndex,
        forkHistory: [
          ...baseBranchPath.forkHistory,
          {
            moveIndex: baseMoveIndex,
            forkIndex: targetMove.forks.length - 1,
          },
        ],
      };

      return Ok({
        newJKF,
        newBranchPath,
      });
    } catch (error) {
      return Err(
        `Failed to create new fork: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // === 分岐削除 ===
  deleteFork(
    jkf: JKFData,
    baseMoveIndex: number,
    baseBranchPath: JKFBranchPath,
    forkIndex: number,
  ): Result<JKFData, string> {
    try {
      // 1. ブランチパスの妥当性チェック
      if (!isValidBranchPath(jkf, baseBranchPath)) {
        return Err("Invalid branch path");
      }

      // 2. JKFDataを深いコピー
      const newJKF = structuredClone(jkf);

      // 3. 対象の手を取得
      const currentBranchMoves = getCurrentBranchMoves(newJKF, baseBranchPath);
      if (baseMoveIndex >= currentBranchMoves.length) {
        return Err("Invalid base move index");
      }

      const targetMove = currentBranchMoves[baseMoveIndex];

      // 4. forksが存在するかチェック
      if (!targetMove.forks || targetMove.forks.length === 0) {
        return Err("No forks exist at this move");
      }

      // 5. forkIndexが有効範囲内かチェック
      if (forkIndex < 0 || forkIndex >= targetMove.forks.length) {
        return Err("Invalid fork index");
      }

      // 6. 指定された分岐を削除
      targetMove.forks.splice(forkIndex, 1);

      // 7. forksが空になった場合はforksプロパティを削除
      if (targetMove.forks.length === 0) {
        delete targetMove.forks;
      }

      return Ok(newJKF);
    } catch (error) {
      return Err(
        `Failed to delete fork: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // === コメント追加 ===
  addComment(
    jkf: JKFData,
    comment: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<JKFData, string> {
    try {
      // 1. ブランチパスの妥当性チェック
      if (!isValidBranchPath(jkf, branchPath)) {
        return Err("Invalid branch path");
      }

      // 2. JKFDataを深いコピー
      const newJKF = structuredClone(jkf);

      // 3. 対象の手を取得
      const currentBranchMoves = getCurrentBranchMoves(newJKF, branchPath);
      if (moveIndex >= currentBranchMoves.length) {
        return Err("Invalid move index");
      }

      const targetMove = currentBranchMoves[moveIndex];

      // 4. commentsがない場合は初期化
      if (!targetMove.comments) {
        targetMove.comments = [];
      }

      // 5. コメントを追加
      targetMove.comments.push(comment);

      return Ok(newJKF);
    } catch (error) {
      return Err(
        `Failed to add comment: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // === 特殊情報追加 ===
  addSpecial(
    jkf: JKFData,
    special: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<JKFData, string> {
    try {
      // 1. ブランチパスの妥当性チェック
      if (!isValidBranchPath(jkf, branchPath)) {
        return Err("Invalid branch path");
      }

      // 2. JKFDataを深いコピー
      const newJKF = structuredClone(jkf);

      // 3. 対象の手を取得
      const currentBranchMoves = getCurrentBranchMoves(newJKF, branchPath);
      if (moveIndex >= currentBranchMoves.length) {
        return Err("Invalid move index");
      }

      const targetMove = currentBranchMoves[moveIndex];

      // 4. 特殊情報を設定
      targetMove.special = special;

      return Ok(newJKF);
    } catch (error) {
      return Err(
        `Failed to add special: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // === ヘッダー更新 ===
  updateHeader(jkf: JKFData, key: string, value: string): JKFData {
    // ヘッダー更新は単純なので直接変更（不変性を保つため深いコピー）
    const newJKF = structuredClone(jkf);

    // headerが存在しない場合は初期化
    if (!newJKF.header) {
      newJKF.header = {};
    }

    // ヘッダーの値を更新
    newJKF.header[key] = value;

    return newJKF;
  }
}
