import type { MoveConvertOptions } from "@/adapter/moveConverter";
import type {
  JKFBranchPath,
  JKFData,
  JKFMove,
  JKFSpecialType,
  JKFState,
  Result,
  ShogiMove,
} from "@/types";

export interface JKFReader {
  // === JKFデータ取得 ===
  getMoveAt(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): JKFMove | null;

  getMovesRange(
    jkf: JKFData,
    fromIndex: number,
    toIndex: number,
    branchPath: JKFBranchPath,
  ): JKFMove[];

  // === 分岐データ取得 ===
  getAvailableForks(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Array<{
    forkIndex: number;
    firstMove: JKFMove;
    totalMoves: number;
  }>;

  // === メタデータ取得 ===
  getCommentsAt(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): string[];

  getSpecialAt(
    jkf: JKFData,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): JKFSpecialType | null;

  // === ヘッダー・初期局面 ===
  getHeader(jkf: JKFData): { [key: string]: string };
  getInitialState(jkf: JKFData): JKFState | null;
}

export interface JKFEditor {
  // === 手の追加（JKFデータ変更） ===
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
  >;

  appendMoveToCurrentBranch(
    jkf: JKFData,
    move: ShogiMove,
    branchPath: JKFBranchPath,
    options?: MoveConvertOptions,
  ): Result<JKFData, string>;

  createNewForkWithMove(
    jkf: JKFData,
    move: ShogiMove,
    baseMoveIndex: number,
    baseBranchPath: JKFBranchPath,
    options: MoveConvertOptions,
  ): Result<
    {
      newJKF: JKFData;
      newBranchPath: JKFBranchPath;
    },
    string
  >;

  // === 分岐削除（JKFデータ変更） ===
  deleteFork(
    jkf: JKFData,
    baseMoveIndex: number,
    baseBranchPath: JKFBranchPath,
    forkIndex: number,
  ): Result<JKFData, string>;

  // === メタデータ変更（JKFデータ変更） ===
  addComment(
    jkf: JKFData,
    comment: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<JKFData, string>;

  addSpecial(
    jkf: JKFData,
    special: string,
    moveIndex: number,
    branchPath: JKFBranchPath,
  ): Result<JKFData, string>;

  // === ヘッダー変更（JKFデータ変更） ===
  updateHeader(jkf: JKFData, key: string, value: string): JKFData;
}
