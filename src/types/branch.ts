import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

// JKFPlayerのForkPointer型を再定義
export type ForkPointer = {
  te: number;          // 手数
  forkIndex: number;   // 分岐インデックス
};

// 分岐情報
export interface BranchInfo {
  id: string;                    // 分岐ID
  startTesuu: number;           // 分岐開始手数
  forkPointers: ForkPointer[];  // 分岐パス
  firstMove: IMoveMoveFormat;   // 分岐の最初の手
  depth: number;                // 分岐の深さ
  length: number;               // 分岐の長さ（手数）
}

// 分岐状態
export interface BranchContextState {
  currentBranchPath: ForkPointer[];  // 現在の分岐パス
  availableBranches: BranchInfo[];   // 利用可能な分岐一覧
  isLoading: boolean;
  error: string | null;
}

// 分岐操作のアクション
export type BranchAction =
  | { type: "set_branch_path"; payload: ForkPointer[] }
  | { type: "update_available_branches"; payload: BranchInfo[] }
  | { type: "set_loading"; payload: boolean }
  | { type: "set_error"; payload: string | null }
  | { type: "clear_error" }
  | { type: "reset_state" };

// コンテキストの型定義
export interface BranchContextType {
  state: BranchContextState;
  
  // 分岐操作
  switchToBranch: (forkPointers: ForkPointer[]) => Promise<void>;
  createBranchFromMove: (move: IMoveMoveFormat) => Promise<boolean>;
  
  // 分岐情報取得
  getCurrentBranchPath: () => ForkPointer[];
  getAvailableBranchesAtTesuu: (tesuu: number) => BranchInfo[];
  hasAvailableBranches: (tesuu: number) => boolean;
  
  // エラー管理
  clearError: () => void;
}

// 初期状態
export const initialBranchState: BranchContextState = {
  currentBranchPath: [],
  availableBranches: [],
  isLoading: false,
  error: null,
};
