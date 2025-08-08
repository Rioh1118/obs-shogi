// 分岐ナビゲーション関連の型定義

import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

// BranchContext用の型定義
export interface ForkPointer {
  te: number;
  forkIndex: number;
}

export interface BranchInfo {
  id: string;
  startTesuu: number;
  forkPointers: ForkPointer[];
  firstMove: IMoveMoveFormat;
}

export interface BranchContextState {
  // 分岐候補一覧
  availableBranches: BranchInfo[];
  // 現在の分岐パス
  currentBranchPath: ForkPointer[];
  isLoading: boolean;
  error: string | null;
}

export interface BranchContextType {
  state: BranchContextState;
  // 分岐候補を再取得したい時
  updateAvailableBranches: () => void;
  // 分岐パスを切り替える
  switchToBranch: (forkPointers: ForkPointer[]) => Promise<void>;
  // 新しい手から分岐を作成
  createBranchFromMove: (move: IMoveMoveFormat) => Promise<boolean>;
  // 現在の分岐パスを取得
  getCurrentBranchPath: () => ForkPointer[];
  // 指定手数の分岐候補を取得
  getAvailableBranchesAtTesuu: (tesuu: number) => BranchInfo[];
  // 指定手数で分岐があるか
  hasAvailableBranches: (tesuu: number) => boolean;
  // エラークリア
  clearError: () => void;
}

export type BranchAction =
  | { type: "set_available_branches"; payload: BranchInfo[] }
  | { type: "set_current_branch_path"; payload: ForkPointer[] }
  | { type: "set_loading"; payload: boolean }
  | { type: "set_error"; payload: string }
  | { type: "clear_error" }
  | { type: "reset_state" };

export const initialBranchState: BranchContextState = {
  availableBranches: [],
  currentBranchPath: [],
  isLoading: false,
  error: null,
};
