// 分岐ナビゲーション関連の型定義

import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { Piece } from "shogi.js";

// === ノード(局面ベースの設計)===
export interface PositionNode {
  id: string;

  // この局面に至る手
  move?: IMoveMoveFormat;

  // 親ノード
  parentId: string | null;

  // 子ノード(この局面から可能な手)
  childrenIds: string[];

  // 局面の情報
  tesuu: number;
  isMainLine: boolean;

  // メタデータ
  comment?: string;
  evaluation?: number;
}

// === 現在位置 ===
export interface CurrentPosition {
  // 現在のノードID
  nodeId: string;

  // ルートから現在ノードまでのパス(ノードIDの配列)
  pathFromRoot: string[];

  // 現在の手数(深さ)
  tesuu: number;
}

// === Context State ===
export interface BranchContextState {
  // ノードのマップ(全局面を保持)
  nodes: Map<string, PositionNode>;

  // ルートノードID
  rootNodeId: string;

  // 現在位置
  currentPosition: CurrentPosition;

  // 現在ノードから可能な次の手 - 常にJKFから計算
  availableMovesFromCurrent: Array<{
    nodeId: string;
    move: IMoveMoveFormat;
    isMainLine: boolean;
    preview: string;
  }>;

  // UI状態
  isLoading: boolean;
  error: string | null;
}

// === Context Type ===
export interface BranchContextType {
  state: BranchContextState;

  // ナビゲーション
  goToNode: (nodeId: string) => void;

  // 分岐操作
  createNewBranch: (move: IMoveMoveFormat) => Promise<string>; // 新たなノードIDを返す
  // 現在ノードの情報を取得
  getCurrentNode: () => PositionNode | null;
  getChildrenNodes: (nodeId: string) => PositionNode[];
  getNode: (nodeId: string) => PositionNode | null;

  // パス操作
  getPathToNode: (nodeId: string) => string[];
}

function generateNodeId(): string {
  const rand = Math.random().toString(36).slice(2, 11); // 9 chars
  return `node_${Date.now()}_${rand}`;
}

export function createPositionNode(
  move: IMoveMoveFormat,
  parentId: string,
  tesuu: number,
  isMainLine: boolean = false,
): PositionNode {
  return {
    id: generateNodeId(),
    move,
    parentId,
    childrenIds: [],
    tesuu,
    isMainLine,
  };
}

export interface PreviewData {
  board: Piece[][];
  hands: {
    0: string[];
    1: string[];
  };
  tesuu: number;
  turn: 0 | 1;
  nodeId: string;
}
