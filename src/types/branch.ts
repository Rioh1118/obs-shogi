import type { JKFMoveMove } from "./jkf";
import type { ShogiMove } from "./shogi";

export type JKFMoveElementType = "move" | "comment" | "special" | "empty";

export interface JKFBranchPath {
  mainMoveIndex: number;
  forkHistory: Array<{
    moveIndex: number;
    forkIndex: number;
  }>;
}

export interface JKFMoveElement {
  type: JKFMoveElementType;
  moveIndex: number;
  content?: {
    move?: JKFMoveMove; // JKF形式の指し手
    comment?: string;
    special?: string;
  };
  availableForks?: number[];
}

export interface BranchNavigationInfo {
  currentPath: JKFBranchPath;
  availableBranches: Array<{
    moveIndex: number;
    forkIndex: number;
    previewMove?: ShogiMove;
    comment?: string;
  }>;
  parentBranch?: JKFBranchPath;
  branchDepth: number;
}
