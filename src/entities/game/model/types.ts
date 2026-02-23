import type { ReactNode } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { Color, Kind } from "shogi.js";

import type { JKFData } from "@/entities/kifu";
import type { AsyncResult } from "@/shared/lib/result";
import type { KifuCursor } from "@/entities/kifu/model/cursor";
import type { DeleteQuery, SwapQuery } from "@/entities/kifu/model/branch";

import type { IMove as ShogiMove } from "shogi.js";
export type { IMove as ShogiMove } from "shogi.js";

export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

export type GameMode = "replay" | "analysis";

export interface GameContextState {
  jkfPlayer: JKFPlayer | null;

  /**
   * 公式カーソル（現局面を一意に表す）
   * - UIの再描画・デバッグ・他Providerへの同期の基準
   */
  cursor: KifuCursor | null;

  selectedPosition: SelectedPosition | null;
  legalMoves: ShogiMove[];

  /** 現局面の一つ前の手 */
  lastMove: ShogiMove | null;

  mode: GameMode;

  /** 現在ロードしている棋譜ファイル（未選択なら null） */
  loadedAbsPath: string | null;

  isLoading: boolean;
  error: string | null;
}

export type GameAction =
  | { type: "set_jkf_player"; payload: JKFPlayer | null }
  | { type: "update_jkf_player" }
  | { type: "set_cursor"; payload: KifuCursor | null }
  | {
      type: "set_selection";
      payload: {
        selectedPosition: SelectedPosition | null;
        legalMoves: ShogiMove[];
      };
    }
  | { type: "clear_selection" }
  | { type: "set_last_move"; payload: ShogiMove | null }
  | { type: "set_mode"; payload: GameMode }
  | { type: "set_loading"; payload: boolean }
  | { type: "set_error"; payload: string | null }
  | { type: "clear_error" }
  | { type: "reset_state" }
  | { type: "partial_update"; payload: Partial<GameContextState> };

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

export type MutateOptions = { forceCommit?: boolean };
export type MutateResult =
  | void
  | boolean
  | { cursorForCommit?: KifuCursor | null; playerForCommit?: JKFPlayer };

export interface JKFPlayerHelpers {
  isLegalMove: (jkfPlayer: JKFPlayer, move: ShogiMove) => boolean;
  canPromoteMove: (jkfPlayer: JKFPlayer, move: ShogiMove) => boolean;
  mustPromoteMove: (jkfPlayer: JKFPlayer, move: ShogiMove) => boolean;
}

export interface StandardMoveFormat {
  from?: { x: number; y: number };
  to: { x: number; y: number };
  piece: Kind;
  promote?: boolean;
  color: Color;
}

export type GamePersistence = {
  save: (jkf: JKFData) => AsyncResult<void, string>;
};

export interface GameContextType {
  state: GameContextState;
  helpers: JKFPlayerHelpers;

  loadGame: (jkf: JKFData, absPath: string | null) => Promise<void>;
  resetGame: () => void;

  goToIndex: (index: number) => void;
  nextMove: () => void;
  previousMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  selectSquare: (x: number, y: number, promote?: boolean) => Promise<void>;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;

  makeMove: (move: StandardMoveFormat) => Promise<void>;
  swapBranches: (q: SwapQuery) => Promise<void>;
  deleteBranch: (q: DeleteQuery) => Promise<void>;

  setMode: (mode: GameMode) => void;
  clearError: () => void;

  isGameLoaded: () => boolean;
  isAtStart: () => boolean;
  isAtEnd: () => boolean;
  canGoForward: () => boolean;
  canGoBackward: () => boolean;

  getCurrentTurn: () => Color;
  getCurrentMoveIndex: () => number;
  getTotalMoves: () => number;

  hasSelection: () => boolean;
  getCurrentMove: () => IMoveMoveFormat | undefined;
  getCurrentComments: () => string[];

  applyCursor: (cursor: KifuCursor) => void;
}

export interface GameProviderProps {
  children: ReactNode;
  persistence?: GamePersistence;
}
