import type {
  Color,
  Kind,
  JKFBranchPath,
  JKFData,
  Shogi,
  ShogiMove,
  BranchNavigationInfo,
} from "@/types";

export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

export type GameMode = "replay" | "analysis";

export interface GameProgress {
  currentJKFIndex: number;
  actualMoveCount: number;
  currentBranchPath: JKFBranchPath;
  totalMovesInBranch: number;
  isAtBranchEnd: boolean;
}

export interface GameState {
  // JKFデータ
  originalJKF: JKFData | null;

  // 盤面状態
  shogiGame: Shogi | null;

  // UI状態
  selectedPosition: SelectedPosition | null;
  legalMoves: ShogiMove[];
  lastMove: ShogiMove | null;
  mode: GameMode;

  //進行状況
  progress: GameProgress;

  // 分岐情報
  branchNavigation: BranchNavigationInfo;

  // システム状態
  isLoading: boolean;
  error: string | null;
}
