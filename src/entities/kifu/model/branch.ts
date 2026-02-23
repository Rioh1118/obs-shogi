import type { ForkPointer, KifuCursor, TesuuPointer } from "./cursor";

/**
 * 0=main, 1.. = forks[branchIndex-1]
 */
export type BranchIndex = number;

export type BranchPointRef = {
  /**
   * 規約: すべて p.te < te
   * (= te の分岐そのものは BranchIndex で指定する)
   */
  forkPointers: ForkPointer[];
  te: number;
};

export type SwapQuery = BranchPointRef & {
  a: BranchIndex;
  b: BranchIndex;
};

export type DeleteQuery = BranchPointRef & {
  target: BranchIndex;
};

export type BranchEditResult = {
  changed: boolean;
  nextCursor: KifuCursor | null;
};

export function forkIndexFromBranchIndex(b: BranchIndex): number {
  if (b <= 0) throw new Error("branchIndex=0 has no forkIndex");
  return b - 1;
}

export function branchIndexFromForkIndex(forkIndex: number): BranchIndex {
  return forkIndex + 1;
}

export function buildTesuuPointer(
  tesuu: number,
  forkPointers: ForkPointer[],
): TesuuPointer {
  // JKFPlayer の "N,[{te,forkIndex}]" と揃える
  return `${tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;
}
