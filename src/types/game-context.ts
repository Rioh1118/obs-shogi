import type { ReactNode } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { JKFData, ShogiMove, Color, Kind } from "@/types";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { GameMode, SelectedPosition } from "@/types/state";
import type { KifuWriter } from "@/interfaces";
import type { StandardMoveFormat } from "@/types";

// Reducer用のState型（シンプル化）
export interface GameContextState {
  // JKFPlayer（棋譜・盤面状態を全て管理）
  jkfPlayer: JKFPlayer | null;
  selectedPosition: SelectedPosition | null;
  legalMoves: ShogiMove[];
  lastMove: ShogiMove | null;
  mode: GameMode;
  isLoading: boolean;
  error: string | null;
}

// Reducer用のAction型
export type GameAction =
  // JKFPlayer管理
  | { type: "set_jkf_player"; payload: JKFPlayer | null }
  | { type: "update_jkf_player" } // 再レンダリング tricker
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
  loadGame: (jkf: JKFData) => Promise<void>;
  // ナビゲーション（JKFPlayerに委譲）
  goToIndex: (index: number) => void;
  nextMove: () => void;
  previousMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;
  selectSquare: (x: number, y: number, promote?: boolean) => void;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;
  makeMove: (move: StandardMoveFormat) => Promise<void>;
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
}

// Provider props
export interface GameProviderProps {
  children: ReactNode;
  kifuWriter: KifuWriter;
}

// 初期状态
export const initialGameState: GameContextState = {
  jkfPlayer: null,
  selectedPosition: null,
  legalMoves: [],
  lastMove: null,
  mode: "replay",
  isLoading: false,
  error: null,
};

// Reducer関数の型
export type GameReducer = (
  state: GameContextState,
  action: GameAction,
) => GameContextState;
