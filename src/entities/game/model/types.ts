import type { ReactNode } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { Color, Kind } from "shogi.js";

import type { JKFData } from "@/entities/kifu";
import type { AsyncResult } from "@/shared/lib/result";
import type { ForkPointer, KifuCursor } from "@/entities/kifu/model/cursor";
import type { DeleteQuery, SwapQuery } from "@/entities/kifu/model/branch";

import type { IMove as ShogiMove } from "shogi.js";

export type { IMove as ShogiMove } from "shogi.js";

export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

export interface GameContextState {
  /** source of truch */
  jkf: JKFData | null;

  /** 現在局面*/
  cursor: KifuCursor | null;

  /**
   * 将来のforward / goToEndで使う分岐計画
   * cursor.forkPointersは現在局面まで
   * branchPlanはその先の分岐も含む
   * */
  branchPlan: ForkPointer[];
  selectedPosition: SelectedPosition | null;

  /** 現在ロードしている棋譜ファイル（未選択なら null） */
  loadedAbsPath: string | null;

  isLoading: boolean;
  error: string | null;
}

export interface GameDerivedState {
  player: JKFPlayer | null;

  legalMoves: ShogiMove[];
  lastMove: ShogiMove | null;

  currentTurn: Color;
  currentMove: IMoveMoveFormat | undefined;
  currentComments: string[];

  leafTesuu: number;

  isGameLoaded: boolean;
  isAtStart: boolean;
  isAtEnd: boolean;
  canGoForward: boolean;
  canGoBackward: boolean;
}

export type GameAction =
  | {
      type: "game_loaded";
      payload: {
        jkf: JKFData;
        cursor: KifuCursor;
        loadedAbsPath: string | null;
      };
    }
  | {
      type: "navigated";
      payload: {
        cursor: KifuCursor;
        branchPlan: ForkPointer[];
      };
    }
  | {
      type: "jkf_replaced";
      payload: {
        jkf: JKFData;
        cursor: KifuCursor;
        branchPlan: ForkPointer[];
      };
    }
  | { type: "set_selection"; payload: SelectedPosition | null }
  | { type: "clear_selection" }
  | { type: "set_loading"; payload: boolean }
  | { type: "set_error"; payload: string | null }
  | { type: "clear_error" }
  | { type: "reset_state" };

export const initialGameState: GameContextState = {
  jkf: null,
  cursor: null,
  branchPlan: [],
  selectedPosition: null,
  loadedAbsPath: null,
  isLoading: false,
  error: null,
};

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
  derived: GameDerivedState;
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

  clearError: () => void;

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
