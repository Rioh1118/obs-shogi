import type { ReactNode } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { JKFData, ShogiMove, Color, Kind } from "@/types";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { GameMode, SelectedPosition } from "@/types/state";
import type { KifuWriter } from "@/interfaces";
import type { StandardMoveFormat } from "@/types";
import type { KifuCursor } from "./kifu-cursor";
import type { DeleteQuery, SwapQuery } from "./branch";

// Reducer用のState型（シンプル化）
export interface GameContextState {
  // JKFPlayer（棋譜・盤面状態を全て管理）
  jkfPlayer: JKFPlayer | null;
  /**
   * 公式カーソル(現局面を一意に表す)
   * - UIの再描画・デバッグ・他Providerへの同期の基準になる
   * - jkfPlayerの状態変化後に必ず同期される想定
   */
  cursor: KifuCursor | null;

  selectedPosition: SelectedPosition | null;
  legalMoves: ShogiMove[];
  /**
   * lastMove:現在局面の一つ前の手である TODO: derivedStateにすべき
   */
  lastMove: ShogiMove | null;
  mode: GameMode;
  loadedAbsPath: string | null;
  isLoading: boolean;
  error: string | null;
}

// Reducer用のAction型
export type GameAction =
  // JKFPlayer管理
  | { type: "set_jkf_player"; payload: JKFPlayer | null }
  | { type: "update_jkf_player" } // 再レンダリング tricker
  | { type: "set_cursor"; payload: KifuCursor | null }
  // 選択状態
  | {
      type: "set_selection";
      payload: {
        selectedPosition: SelectedPosition | null;
        legalMoves: ShogiMove[];
      };
    }
  | { type: "clear_selection" }
  // 手の記録
  | { type: "set_last_move"; payload: ShogiMove | null }
  // モード
  | { type: "set_mode"; payload: GameMode }
  // ローディング・エラー
  | { type: "set_loading"; payload: boolean }
  | { type: "set_error"; payload: string | null }
  | { type: "clear_error" }
  // 初期化・リセット
  | { type: "reset_state" }
  // 部分更新
  | { type: "partial_update"; payload: Partial<GameContextState> };

// JKFPlayer操作のヘルパー関数群
export interface JKFPlayerHelpers {
  // 状態判定
  isLegalMove: (jkfPlayer: JKFPlayer, move: ShogiMove) => boolean;
  canPromoteMove: (jkfPlayer: JKFPlayer, move: ShogiMove) => boolean;
  mustPromoteMove: (jkfPlayer: JKFPlayer, move: ShogiMove) => boolean;
}

// GameContextの状態とメソッド
export interface GameContextType {
  state: GameContextState;
  helpers: JKFPlayerHelpers;
  // 基本操作
  loadGame: (jkf: JKFData, absPath: string | null) => Promise<void>;
  // ナビゲーション（JKFPlayerに委譲）
  goToIndex: (index: number) => void;
  nextMove: () => void;
  previousMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  // 入力・選択
  selectSquare: (x: number, y: number, promote?: boolean) => void;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;
  makeMove: (move: StandardMoveFormat) => Promise<void>;
  swapBranches: (q: SwapQuery) => Promise<void>;
  deleteBranch: (q: DeleteQuery) => Promise<void>;
  // addComment: (comment: string) => Promise<void>; // 書き込み
  // モード・エラー管理
  setMode: (mode: GameMode) => void;
  clearError: () => void;
  // 便利な判定関数（JKFPlayerのプロパティを使用）
  isGameLoaded: () => boolean;
  isAtStart: () => boolean;
  isAtEnd: () => boolean;
  getCurrentTurn: () => Color | null;
  getCurrentMoveIndex: () => number;
  getTotalMoves: () => number;
  hasSelection: () => boolean;

  // 棋譜情報取得（JKFPlayerのメソッドを使用）
  getCurrentMove: () => IMoveMoveFormat | undefined;
  getCurrentComments: () => string[];
  canGoForward: () => boolean;
  canGoBackward: () => boolean;
  applyCursor: (cursor: KifuCursor) => void;
}

// Provider props
export interface GameProviderProps {
  children: ReactNode;
  kifuWriter: KifuWriter;
}

// 初期状态
export const initialGameState: GameContextState = {
  jkfPlayer: null,
  cursor: null,
  selectedPosition: null,
  legalMoves: [],
  lastMove: null,
  mode: "replay",
  loadedAbsPath: null,
  isLoading: false,
  error: null,
};

// Reducer関数の型
export type GameReducer = (
  state: GameContextState,
  action: GameAction,
) => GameContextState;

export type MutateOptions = { forceCommit?: boolean };

export type MutateResult =
  | void
  | boolean
  | { cursorForCommit?: KifuCursor | null; playerForCommit?: JKFPlayer };
