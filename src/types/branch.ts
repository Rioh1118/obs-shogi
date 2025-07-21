// 分岐ナビゲーション関連の型定義

export interface BranchMove {
  move: any; // JKF move object
  tesuu: number;
  description?: string;
}

export interface Branch {
  id: string;
  startTesuu: number;
  length: number;
  moves: BranchMove[];
  firstMove: any; // JKF move object
  forkIndex: number;
  forkPointers: Array<{
    forkIndex: number;
    moveIndex: number;
  }>;
}

export interface PreviewState {
  tesuu: number;
  branchIndex: number; // 0 = メイン線, 1+ = 分岐
  branchSteps: number; // 分岐内での手数
}

export interface NavigationState {
  currentTesuu: number;
  selectedBranchIndex: number;
  preview: PreviewState;
}

export interface BranchCalculationResult {
  branches: Branch[];
  hasMore: boolean;
  error?: string;
}

export interface BranchNavigationResult {
  success: boolean;
  newState?: NavigationState;
  error?: string;
}

export interface PreviewData {
  board: any[][]; // Piece[][]
  hands: { [key: number]: string[] };
  turn: any; // Color
  tesuu: number;
}

// BranchContext用の型定義
export interface ForkPointer {
  forkIndex: number;
  moveIndex: number;
}

export interface BranchInfo {
  id: string;
  startTesuu: number;
  forkPointers: ForkPointer[];
  moves: any[];
}

export interface BranchContextState {
  branches: BranchInfo[];
  currentBranch: BranchInfo | null;
  isLoading: boolean;
  error: string | null;
}

export interface BranchAction {
  type: string;
  payload?: any;
}

export interface BranchContextType {
  state: BranchContextState;
  dispatch: (action: BranchAction) => void;
  getAvailableBranchesAtTesuu: (tesuu: number) => BranchInfo[];
  switchToBranch: (branchId: string) => boolean;
}

export const initialBranchState: BranchContextState = {
  branches: [],
  currentBranch: null,
  isLoading: false,
  error: null,
};
