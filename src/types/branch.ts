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

  // 現在ノードから可能な次の手
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
  goToPositionAtTesuu: (tesuu: number, preferMainLine?: boolean) => void;
  nextMove: () => void;
  previousMove: () => void;
  // 分岐操作
  selectBranch: (childNodeId: string) => void;
  createNewBranch: (move: IMoveMoveFormat) => Promise<string>; // 新たなノードIDを返す
  // 現在ノードの情報を取得
  getCurrentNode: () => PositionNode | null;
  getAvailableMovesFromCurrent: () => Array<{
    nodeId: string;
    move: IMoveMoveFormat;
  }>;
  getCurrentPath: () => PositionNode[];

  // パス操作
  getPathToNode: (nodeId: string) => string[];
  isAncestor: (nodeId: string, ofNodeId: string) => boolean;
  // エラークリア
  clearError: () => void;
}

// === Actions ===
export type BranchAction =
  // ノード管理
  | { type: "set_nodes"; payload: Map<string, PositionNode> }
  | { type: "add_node"; payload: PositionNode }
  | {
      type: "update_node";
      payload: { nodeId: string; updates: Partial<PositionNode> };
    }
  | {
      type: "add_child_to_node";
      payload: {
        parentId: string;
        childId: string;
      };
    }
  // 現在位置の管理
  | {
      type: "set_current_position";
      payload: CurrentPosition;
    }
  | {
      type: "move_to_node";
      payload: string;
    }
  | {
      type: "update_path";
      payload: string[];
    }
  // 利用可能な手の管理
  | {
      type: "set_available_moves";
      payload: Array<{
        nodeId: string;
        move: IMoveMoveFormat;
        isMainLine: boolean;
        preview: string;
      }>;
    }
  // ルートノード
  | {
      type: "set_root_node";
      payload: string;
    } // UI状態
  | {
      type: "set_loading";
      payload: boolean;
    }
  | {
      type: "set_error";
      payload: string | null;
    }
  | {
      type: "reset_to_initial";
    }
  | {
      type: "load_tree";
      payload: {
        nodes: Map<string, PositionNode>;
        rootNodeId: string;
        currentNodeId?: string;
      };
    };

// === 初期状態 ===
export const initialBranchState = {
  nodes: new Map([
    [
      "root",
      {
        id: "root",
        move: undefined,
        parentId: null,
        childrenIds: [],
        tesuu: 0,
        isMainLine: true,
        comment: "初期局面",
      },
    ],
  ]),
  rootNodeId: "root",
  currentPosition: {
    nodeId: "root",
    pathFromRoot: ["root"],
    tesuu: 0,
  },
  availableMovesFromCurrent: [],
  isLoading: false,
  error: null,
};

// === Reducer ===
export function branchReducer(
  state: BranchContextState,
  action: BranchAction,
): BranchContextState {
  switch (action.type) {
    // ノード管理
    case "set_nodes":
      return {
        ...state,
        nodes: action.payload,
      };
    case "add_node": {
      const newNodes = new Map(state.nodes);
      newNodes.set(action.payload.id, action.payload);
      return {
        ...state,
        nodes: newNodes,
      };
    }
    case "update_node": {
      const { nodeId, updates } = action.payload;
      const node = state.nodes.get(nodeId);
      if (!node) return state;
      const newNodes = new Map(state.nodes);
      newNodes.set(nodeId, { ...node, ...updates });
      return {
        ...state,
        nodes: newNodes,
      };
    }
    case "add_child_to_node": {
      const { parentId, childId } = action.payload;
      const parent = state.nodes.get(parentId);
      if (!parent) return state;

      const newNodes = new Map(state.nodes);
      newNodes.set(parentId, {
        ...parent,
        childrenIds: [...parent.childrenIds, childId],
      });
      return {
        ...state,
        nodes: newNodes,
      };
    }
    // 現在位置の管理
    case "set_current_position": {
      return {
        ...state,
        currentPosition: action.payload,
      };
    }

    case "move_to_node": {
      const nodeId = action.payload;
      const node = state.nodes.get(nodeId);
      if (!node) return state;

      // パスを再構築
      const pathFromRoot: string[] = [];
      let current: PositionNode | undefined = node;

      while (current) {
        pathFromRoot.unshift(current.id);
        current = current.parentId
          ? state.nodes.get(current.parentId)
          : undefined;
      }

      return {
        ...state,
        currentPosition: {
          nodeId,
          pathFromRoot,
          tesuu: node.tesuu,
        },
      };
    }

    // 利用可能な手
    case "set_available_moves":
      return {
        ...state,
        availableMovesFromCurrent: action.payload,
      };
    // ルートノード
    case "set_root_node":
      return {
        ...state,
        rootNodeId: action.payload,
      };

    // UI状態
    case "set_loading":
      return {
        ...state,
        isLoading: action.payload,
      };

    case "set_error":
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };

    // リセット
    case "reset_to_initial":
      return initialBranchState;

    case "load_tree": {
      const { nodes, rootNodeId, currentNodeId } = action.payload;
      const nodeId = currentNodeId || rootNodeId;
      const node = nodes.get(nodeId);

      if (!node) {
        return {
          ...state,
          nodes,
          rootNodeId,
        };
      }

      // パスを構築
      const pathFromRoot: string[] = [];
      let current: PositionNode | undefined = node;

      while (current) {
        pathFromRoot.unshift(current.id);
        current = current.parentId ? nodes.get(current.parentId) : undefined;
      }

      return {
        ...state,
        nodes,
        rootNodeId,
        currentPosition: {
          nodeId,
          pathFromRoot,
          tesuu: node.tesuu,
        },
      };
    }

    default:
      return state;
  }
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
