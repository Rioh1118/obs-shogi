import type { ReactNode } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import type { Color, Kind } from "shogi.js";

import type { JKFData } from "@/entities/kifu/model/jkf";
import type { AsyncResult } from "@/shared/lib/result";
import { asBranchPlan, type BranchPlan, type KifuCursor } from "@/entities/kifu/model/cursor";
import type { DeleteQuery, SwapQuery } from "@/entities/kifu/model/branch";

import type { IMove as ShogiMove } from "shogi.js";
export type { IMove as ShogiMove } from "shogi.js";

export type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

export interface GameContextState {
  jkf: JKFData | null;

  /** 現在局面 */
  cursor: KifuCursor | null;

  /**
   * 将来の forward / goToIndex / goToEnd で使う進路計画
   * 現在地点までの forkPointers も含む
   */
  branchPlan: BranchPlan;

  selectedPosition: SelectedPosition | null;

  /** 現在ロードしている棋譜ファイル（未選択なら null） */
  loadedAbsPath: string | null;

  isLoading: boolean;
  error: string | null;
}

export interface GameView {
  player: JKFPlayer | null;

  legalMoves: ShogiMove[];
  lastMove: ShogiMove | null;
  currentMove: IMoveMoveFormat | undefined;
  currentComments: string[];
  currentTurn: Color;

  /** branchPlan を考慮した終端手数 */
  totalMoves: number;

  /**
   * 現在の局面の SFEN。棋譜カーソルから導かれる射影であり、駒の選択には依存しない。
   * 手数フィールドは常に 1 以上（SFEN の手数は 1 始まり）。
   * 局面を組み立てられない間は null。
   */
  currentSfen: string | null;
}

export type GameAction =
  | {
      type: "game_loaded";
      payload: {
        jkf: JKFData;
        absPath: string | null;
        cursor: KifuCursor;
      };
    }
  | {
      type: "navigated";
      payload: {
        cursor: KifuCursor;
        branchPlan: BranchPlan;
      };
    }
  | {
      type: "jkf_replaced";
      payload: {
        jkf: JKFData;
        cursor: KifuCursor;
        branchPlan: BranchPlan;
      };
    }
  | {
      type: "set_selection";
      payload: SelectedPosition | null;
    }
  | {
      type: "clear_selection";
    }
  | {
      type: "set_loading";
      payload: boolean;
    }
  | {
      type: "set_error";
      payload: string | null;
    }
  | {
      type: "clear_error";
    }
  | {
      type: "reset_state";
    };

export const initialGameState: GameContextState = {
  jkf: null,
  cursor: null,
  branchPlan: asBranchPlan([]),
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
  view: GameView;
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

  // 棋譜を書き換える操作。**どれも throw しない。** 失敗は `Err` で返る。
  //
  // `state.error` にも積むが、それを描いている場所はまだ無い（#186）。
  // 戻り値を捨てると、書けなかったことが利用者にも呼び出し側にも届かない。
  // 捨てるのが正しい呼び出しは `// async-result-ignored: <理由>` を付けること
  // （`src/__tests__/asyncResultUse.test.ts`）。
  //
  // `Ok` は「棋譜が意図どおりになった」。**何も変えなかった場合も `Ok`**
  // （変える必要が無かったのは失敗ではない）。
  makeMove: (move: StandardMoveFormat) => AsyncResult<void, string>;
  swapBranches: (q: SwapQuery) => AsyncResult<void, string>;
  deleteBranch: (q: DeleteQuery) => AsyncResult<void, string>;

  getCommentsByCursor: (cursor: KifuCursor | null) => string[];
  setCommentsByCursor: (cursor: KifuCursor, comments: string[]) => AsyncResult<void, string>;
  setCurrentComments: (comments: string[]) => AsyncResult<void, string>;

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
