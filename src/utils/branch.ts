import type { JKFBranchPath, JKFData, JKFMove } from "@/types";

// ブランチナビゲーション関連
export function getCurrentBranchMoves(
  jkf: JKFData,
  branchPath: JKFBranchPath,
): JKFMove[] {
  let currentMoves = jkf.moves;

  // forkHistoryを順番たどって、現在の分岐のmoves配列を取得
  for (const fork of branchPath.forkHistory) {
    const moveAtFork = currentMoves[fork.moveIndex];

    // forksが存在し、指定されたforkIndexが有効かチェック
    if (!moveAtFork?.forks || fork.forkIndex >= moveAtFork.forks.length) {
      return []; // 無効な分岐パスの場合はから配列
    }

    // 指定された分岐のmoves配列に移動
    currentMoves = moveAtFork.forks[fork.forkIndex];
  }

  return currentMoves;
}

export function getTotalMovesInBranch(
  jkf: JKFData,
  branchPath: JKFBranchPath,
): number {
  const currentBranchMoves = getCurrentBranchMoves(jkf, branchPath);
  return currentBranchMoves.length;
}

export function isAtBranchEnd(
  jkf: JKFData,
  branchPath: JKFBranchPath,
  currentIndex: number,
): boolean {
  const totalMoves = getTotalMovesInBranch(jkf, branchPath);

  // 現在のインデックスが分岐内の最後のインデックスと等しいかチェック
  return currentIndex === totalMoves - 1;
}

// ブランチ情報取得
export function getAvailableBranches(
  jkf: JKFData,
  moveIndex: number,
): Array<{
  moveIndex: number;
  forkIndex: number;
}> {
  // 指定されたmoveIndexが有効範囲内かチェック
  if (moveIndex < 0 || moveIndex >= jkf.moves.length) {
    return [];
  }

  const moveAtIndex = jkf.moves[moveIndex];

  // forkが存在しない場合は空の配列を返す
  if (!moveAtIndex?.forks) {
    return [];
  }

  // 各分岐の情報を収集
  return moveAtIndex.forks.map((_, forkIndex) => ({
    moveIndex,
    forkIndex,
  }));
}

export function getBranchDepth(branchPath: JKFBranchPath): number {
  return branchPath.forkHistory.length;
}

export function getParentBranch(
  branchPath: JKFBranchPath,
): JKFBranchPath | undefined {
  // メイン手順の場合は親分岐が存在しない
  if (branchPath.forkHistory.length === 0) {
    return undefined;
  }

  // forkHistoryの最後の要素を除いた親分岐パスを作成
  return {
    mainMoveIndex: branchPath.mainMoveIndex,
    forkHistory: branchPath.forkHistory.slice(0, -1),
  };
}

// ブランチパス操作
export function createBranchPath(
  mainMoveIndex: number,
  forkHistory?: Array<{ moveIndex: number; forkIndex: number }>,
): JKFBranchPath {
  return {
    mainMoveIndex,
    forkHistory: forkHistory ?? [],
  };
}

export function isValidBranchPath(
  jkf: JKFData,
  branchPath: JKFBranchPath,
): boolean {
  // mainMoveIndexの有効範囲内かチェック
  if (
    branchPath.mainMoveIndex < 0 ||
    branchPath.mainMoveIndex >= jkf.moves.length
  ) {
    return false;
  }

  let currentMoves = jkf.moves;

  // forkHistoryの各段階で有効性チェック
  for (const fork of branchPath.forkHistory) {
    // moveIndexが現在のmove配列の範囲内かチェック
    if (fork.moveIndex < 0 || fork.moveIndex >= currentMoves.length) {
      return false;
    }

    const moveAtFork = currentMoves[fork.moveIndex];

    if (!moveAtFork?.forks) {
      return false;
    }

    // forkIndexが有効範囲内かチェック
    if (fork.forkIndex < 0 || fork.forkIndex >= moveAtFork.forks.length) {
      return false;
    }

    // 次の分岐レベルに移動
    currentMoves = moveAtFork.forks[fork.forkIndex];
  }
  return true;
}

// ブランチ移動
export function canNavigateToIndex(
  jkf: JKFData,
  branchPath: JKFBranchPath,
  targetIndex: number,
): boolean {
  // branchPathが有効か
  if (!isValidBranchPath(jkf, branchPath)) {
    return false;
  }

  // targetIndexが負の値でないかチェック
  if (targetIndex < 0) {
    return false;
  }

  // 現在の分岐で総手数を取得
  const totalMoves = getTotalMovesInBranch(jkf, branchPath);

  return targetIndex < totalMoves;
}

export function getNextValidIndex(
  jkf: JKFData,
  branchPath: JKFBranchPath,
  currentIndex: number,
): number | null {
  if (!isValidBranchPath(jkf, branchPath)) {
    return null;
  }

  const nextIndex = currentIndex + 1;

  // 次のインデックスに移動可能かチェック
  if (canNavigateToIndex(jkf, branchPath, nextIndex)) {
    return nextIndex;
  }

  // 移動できない場合はnull
  return null;
}

export function getPreviousValidIndex(
  jkf: JKFData,
  branchPath: JKFBranchPath,
  currentIndex: number,
): number | null {
  if (!isValidBranchPath(jkf, branchPath)) {
    return null;
  }

  const previousIndex = currentIndex - 1;

  // 前のインデックスに移動可能かチェック
  if (canNavigateToIndex(jkf, branchPath, previousIndex)) {
    return previousIndex;
  }

  // 移動できない場合はnullを返す
  return null;
}

// ブランチ比較
export function isSameBranch(
  path1: JKFBranchPath,
  path2: JKFBranchPath,
): boolean {
  // mainMoveIndexが異なる場合は異なる分岐
  if (path1.mainMoveIndex !== path2.mainMoveIndex) {
    return false;
  }

  // forkHistoryの長さが異なる場合は異なる分岐
  if (path1.forkHistory.length !== path2.forkHistory.length) {
    return false;
  }

  // forkHistoryの各要素を比較
  for (let i = 0; i < path1.forkHistory.length; i++) {
    const fork1 = path1.forkHistory[i];
    const fork2 = path2.forkHistory[i];

    if (
      fork1.moveIndex !== fork2.moveIndex ||
      fork1.forkIndex !== fork2.forkIndex
    ) {
      return false;
    }
  }

  return true;
}
export function isMainBranch(branchPath: JKFBranchPath): boolean {
  return branchPath.forkHistory.length === 0;
}
