import { Shogi, Color, type Kind, type IMove } from "shogi.js";
import type { JKFFormat } from "./kifu";

export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

// JKF形式に基づいた分岐情報
export interface JKFBranchInfo {
  // JKFのmoves配列内での位置
  moveIndex: number;
  // 分岐のインデックス
  forkIndex: number;
  // 分岐の深さ
  depth: number;
  // 分岐の親となる手番
  parentMoveIndex: number;
}

// JKF形式での分岐パス(ルートから現在位置までの経路)
export interface JKFBranchPath {
  // メイン分岐での手番
  mainMoveIndex: number;
  // 分岐の履歴 [手番、分岐インデックス]のペア
  forkHistory: Array<{
    moveIndex: number;
    forkIndex: number;
  }>;
}

export interface JKFMoveElement {
  type: "move" | "comment" | "special" | "empty";
  moveIndex: number;
  content?: {
    move?: IMove;
    comment?: string;
    special?: string;
  };
  availableForks?: number[];
}

// ゲームの進行状況
export interface GameProgress {
  // JKF moves配列での現在位置
  currentJKFIndex: number;
  // 実際の手数 (空要素やコメント除く)
  actualMoveCount: number;
  // 現在の分岐パス
  currentBranchPath: JKFBranchPath;
  // 総手数
  totalMovesInBranch: number;
  // 分岐終端かどうか
  isAtBranchEnd: boolean;
}

// 分岐ナビゲーション情報
export interface BranchNavigationInfo {
  // 現在の分岐パス
  currentPath: JKFBranchPath;
  // 利用可能な分岐点
  availableBranches: Array<{
    moveIndex: number;
    forkIndex: number;
    previewMove?: IMove;
    comment?: string;
  }>;
  // 親分岐への戻り情報
  parentBranch?: JKFBranchPath;
  // 分岐の深さ
  branchDepth: number;
}

export type GameState = {
  originalJKF: JKFFormat | null;
  // JKF moves配列での現在位置
  currentMoveIndex: number;
  // 現在の分岐パス
  currentBranchPath: JKFBranchPath;
  shogiGame: Shogi | null;
  selectedPosition: SelectedPosition | null;
  legalMoves: IMove[];
  lastMove: IMove | null;
  mode: "replay" | "analysis";
  // ゲームの進行状況
  progress: GameProgress;
  // 分岐ナビゲーション情報
  branchNavigation: BranchNavigationInfo;
  isLoading: boolean;
  error: string | null;
};

export type GameAction =
  // システム操作
  | { type: "loading" }
  | { type: "error"; payload: string }
  | { type: "clear_error" }
  // ゲーム初期化
  | { type: "initialize_from_jkf"; payload: JKFFormat | null }
  | { type: "update_shogi_game"; payload: Shogi }
  //JKF要素への移動
  | {
      type: "go_to_jkf_index";
      payload: {
        jkfIndex: number;
        branchPath: JKFBranchPath;
        lastMove: IMove | null;
        progress: GameProgress;
        branchNavigation: BranchNavigationInfo;
      };
    }
  // 選択操作
  | { type: "select_square"; payload: { x: number; y: number } }
  | { type: "select_hand"; payload: { color: Color; kind: Kind } }
  | { type: "clear_selection" }
  | { type: "update_legal_moves"; payload: IMove[] }
  // 手の追加
  | {
      type: "apply_move";
      payload: {
        move: IMove;
        newJkf: JKFFormat;
        newBranchPath: JKFBranchPath;
        progress: GameProgress;
        branchNavigation: BranchNavigationInfo;
      };
    }
  // コメント* moveに特殊要素の追加
  | {
      type: "add_comment";
      payload: {
        comment: string;
        newJkf: JKFFormat;
        jkfIndex: number;
      };
    }
  | {
      type: "add_special";
      payload: {
        special: string;
        newJkf: JKFFormat;
        jkfIndex: number;
      };
    }
  // 分岐操作
  | {
      type: "switch_to_branch";
      payload: {
        branchPath: JKFBranchPath;
        jkfIndex: number;
        progress: GameProgress;
        branchNavigation: BranchNavigationInfo;
      };
    }
  | {
      type: "create_branch";
      payload: {
        parentMoveIndex: number;
        move: IMove;
        newJkf: JKFFormat;
        newBranchPath: JKFBranchPath;
      };
    }
  // | {
  //     type: "delete_branch";
  //     payload: {
  //       newJkf: JKFFormat;
  //       newBranchPath: JKFBranchPath;
  //       jkfIndex: number;
  //       progress: GameProgress;
  //       branchNavigation: BranchNavigationInfo;
  //     };
  //   }
  | { type: "set_mode"; payload: "replay" | "analysis" };

// ゲーム操作のインターフェース
export interface GameOperations {
  // 基本操作
  loadGame: (jkf: JKFFormat) => void;
  // JKFナビゲーション
  goToJKFIndex: (index: number) => void;
  goToJKFIndexWithBranch: (index: number, branchPath: JKFBranchPath) => void;
  nextElement: () => void; // 次のJKF要素（手、コメント、特殊要素）
  previousElement: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  // 手の操作
  nextMove: () => void; // 次の実際の手（コメントなどをスキップ）
  previousMove: () => void;

  // 選択操作
  selectSquare: (position: { x: number; y: number }) => void;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;

  // 要素の追加
  makeMove: (move: IMove) => void;
  addComment: (comment: string) => void;
  addSpecial: (special: string) => void; // "中断", "投了" など

  // 分岐操作
  switchToBranch: (branchPath: JKFBranchPath) => void;
  createBranch: (move: IMove) => void;
  deleteBranch: (branchPath: JKFBranchPath) => void;

  // モード変更
  setMode: (mode: "replay" | "analysis") => void;

  // エラー処理
  clearError: () => void;
}
