import type { ForkPointer, KifuCursor, TesuuPointer } from "./cursor";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

/**
 * 0=main, 1.. = forks[branchIndex-1]
 */
export type BranchIndex = number;

/** 手数 N から指せる分岐の候補。 */
export type BranchOption = {
  /** リスト描画の key 用。安定していればよく、意味は持たない。 */
  id: string;
  /** `forkIndex === undefined` と等価。 */
  isMainLine: boolean;
  tesuu: number;
  move?: IMoveMoveFormat;
  /** `IMoveFormat.forks` の添字。ForkPointer の値ではない。本譜なら undefined。 */
  forkIndex?: number;
};

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

export function buildTesuuPointer(tesuu: number, forkPointers: ForkPointer[]): TesuuPointer {
  // JKFPlayer の "N,[{te,forkIndex}]" と揃える
  return `${tesuu},${JSON.stringify(forkPointers)}` as TesuuPointer;
}
