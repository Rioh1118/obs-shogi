// src/types/branchNav.ts
import type {
  IMoveFormat,
  IMoveMoveFormat,
} from "json-kifu-format/dist/src/Formats";

export type ForkPointer = { te: number; forkIndex: number };

export type Pointer = {
  tesuu: number;
  path: ForkPointer[];
};

export type Branch = {
  id: string;
  startTesuu: number; // 親ノードの tesuu
  forkIndex: number; // 親ノードの forks の index
  path: ForkPointer[]; // 自身に入るための path
  length: number; // moves.length
  moves: IMoveFormat[]; // 変化全体
  firstMove: IMoveMoveFormat;
  description?: string;
};

export type PreviewData = {
  board: ReturnType<
    typeof import("json-kifu-format").JKFPlayer.getState
  >["board"];
  hands: ReturnType<
    typeof import("json-kifu-format").JKFPlayer.getState
  >["hands"];
  tesuu: number;
};

export type NavigationState = {
  current: Pointer; // 確定位置
  preview: Pointer; // モーダルで見ている位置
  selectedFork: number; // 0 = 本筋, 1~ = 変化
};

export type BranchNavigationResult =
  | { success: true; newState: NavigationState }
  | { success: false; error: string };
