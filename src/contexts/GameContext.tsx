import {
  createContext,
  useReducer,
  useEffect,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { Shogi } from "shogi.js";
import type { JKFFormat } from "@/types/kifu";
import { useFileTree } from "./FileTreeContext";
import { Color, type Kind, type IMove, Piece } from "shogi.js";

type SelectedPosition =
  | { type: "square"; x: number; y: number }
  | { type: "hand"; color: Color; kind: Kind };

type GameState = {
  // 棋譜関連
  originalJKF: JKFFormat | null;
  currentMoveIndex: number;
  // shogi.js関連
  shogiGame: Shogi | null;
  // UI状態
  selectedPosition: SelectedPosition | null;
  legalMoves: IMove[];
  lastMove: IMove | null;
  // モード
  mode: "replay" | "analysis";
  // エラー・ローディング
  isLoading: boolean;
  error: string | null;
};

type GameAction =
  | { type: "loading" }
  | { type: "initialize_from_jkf"; payload: JKFFormat }
  | { type: "go_to_move"; payload: { index: number; lastMove: IMove | null } }
  | { type: "select_square"; payload: { x: number; y: number } }
  | { type: "select_hand"; payload: { color: Color; kind: Kind } }
  | { type: "clear_selection" }
  | { type: "set_mode"; payload: "replay" | "analysis" }
  | { type: "error"; payload: string }
  | { type: "update_shogi_game"; payload: Shogi };

const initialState: GameState = {
  originalJKF: null,
  currentMoveIndex: 0,
  shogiGame: null,
  selectedPosition: null,
  legalMoves: [],
  lastMove: null,
  mode: "replay",
  isLoading: false,
  error: null,
};

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "loading":
      return { ...state, isLoading: true, error: null };
    case "initialize_from_jkf":
      return {
        ...state,
        originalJKF: action.payload,
        currentMoveIndex: 0,
        selectedPosition: null,
        legalMoves: [],
        lastMove: null,
        mode: "replay",
        isLoading: false,
        error: null,
      };
    case "go_to_move":
      return {
        ...state,
        currentMoveIndex: action.payload.index,
        lastMove: action.payload.lastMove,
        selectedPosition: null,
        legalMoves: [],
        isLoading: false,
      };
    case "update_shogi_game":
      return {
        ...state,
        shogiGame: action.payload,
      };
    case "select_square":
      return {
        ...state,
        selectedPosition: { type: "square", ...action.payload },
        legalMoves: state.shogiGame
          ? state.shogiGame.getMovesFrom(action.payload.x, action.payload.y)
          : [],
      };
    case "select_hand":
      return {
        ...state,
        selectedPosition: { type: "hand", ...action.payload },
        legalMoves: state.shogiGame
          ? state.shogiGame.getDropsBy(action.payload.color)
          : [],
      };
    case "clear_selection":
      return {
        ...state,
        selectedPosition: null,
        legalMoves: [],
      };
    case "set_mode":
      return {
        ...state,
        mode: action.payload,
      };
    case "error":
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };
    default:
      return state;
  }
}

type GameContextType = GameState & {
  initializeFromJKF: (jkf: JKFFormat) => void;
  goToMove: (index: number) => void;
  nextMove: () => void;
  prevMove: () => void;
  resetToInitial: () => void;
  selectSquare: (x: number, y: number) => void;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;
  getCurrentBoard: () => Piece[][] | null;
  getCurrentHands: () => Piece[][] | null;
  getCurrentTurn: () => Color | null;
  // 棋譜再生用メソッド
  goToStart: () => void;
  goToEnd: () => void;
  totalMoves: number;
  canGoBack: boolean;
  canGoForward: boolean;
};

const GameContext = createContext<GameContextType | undefined>(undefined);

function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { jkfData } = useFileTree();

  const initializeShogiFromJKF = useCallback((jkf: JKFFormat): Shogi => {
    const shogi = new Shogi();
    if (jkf.initial?.preset === "HIRATE" || !jkf.initial?.data) {
      shogi.initialize();
    } else {
      // カスタム局面の場合(後で実装)
      shogi.initialize();
      // TODO: jkf.initial.dataから盤面・持ち駒・手番を設定
    }
    return shogi;
  }, []);

  const convertToShogiKind = useCallback((jkfPiece: string): Kind => {
    const validKinds: Kind[] = [
      "FU",
      "KY",
      "KE",
      "GI",
      "KI",
      "KA",
      "HI",
      "OU",
      "TO",
      "NY",
      "NK",
      "NG",
      "UM",
      "RY",
    ];
    if (validKinds.includes(jkfPiece as Kind)) {
      return jkfPiece as Kind;
    }
    throw new Error(`不正な駒種類: ${jkfPiece}`);
  }, []);

  // JKFから実際の手数を計算（moves[0]と特殊手を除外）
  const getActualMoveCount = useCallback((jkf: JKFFormat): number => {
    if (!jkf.moves || jkf.moves.length <= 1) return 0;

    let count = 0;
    // moves[0]は初期局面用なのでスキップ、moves[1]から開始
    for (let i = 1; i < jkf.moves.length; i++) {
      const moveData = jkf.moves[i];
      if (moveData.move) {
        count++;
      } else if (moveData.special) {
        // 特殊手（投了、中断など）は手数に含めない
        break;
      }
    }
    return count;
  }, []);

  // 指定手数まで進める
  const applyShogiMovesToIndex = useCallback(
    (jkf: JKFFormat, targetIndex: number) => {
      const newShogi = initializeShogiFromJKF(jkf);
      let lastMove: IMove | null = null;

      // moves[1]からtargetIndex手目まで適用
      // moves[0]は初期局面用なのでスキップ
      for (let i = 1; i <= targetIndex && i < jkf.moves.length; i++) {
        const moveData = jkf.moves[i];

        if (moveData.move) {
          const { from, to, piece, promote, color } = moveData.move;
          try {
            const shogiKind = convertToShogiKind(piece);
            if (from) {
              // 駒移動
              newShogi.move(from.x, from.y, to!.x, to!.y, promote || false);
            } else {
              // 駒打ち
              newShogi.drop(to!.x, to!.y, shogiKind, color);
            }
            lastMove = {
              from: from ? { x: from.x, y: from.y } : undefined,
              to: { x: to!.x, y: to!.y },
              kind: shogiKind,
              color,
            };
          } catch (err) {
            console.error(`手の適用に失敗: ${i}手目`, err);
            throw err;
          }
        } else if (moveData.special) {
          // 特殊手（投了、中断など）は局面を変更せずに終了
          console.log(`特殊手を検出: ${moveData.special} at move ${i}`);
          break;
        }
      }

      return { shogi: newShogi, lastMove };
    },
    [initializeShogiFromJKF, convertToShogiKind],
  );

  // useEffectでjkfDataの初期化
  useEffect(() => {
    if (jkfData) {
      try {
        dispatch({ type: "loading" });
        const shogi = initializeShogiFromJKF(jkfData);
        dispatch({ type: "initialize_from_jkf", payload: jkfData });
        dispatch({ type: "update_shogi_game", payload: shogi });
      } catch (error) {
        dispatch({
          type: "error",
          payload: `棋譜の初期化に失敗しました: ${error}`,
        });
      }
    }
  }, [jkfData, initializeShogiFromJKF]);

  const initializeFromJKF = useCallback(
    (jkf: JKFFormat) => {
      try {
        dispatch({ type: "loading" });
        const shogi = initializeShogiFromJKF(jkf);
        dispatch({ type: "initialize_from_jkf", payload: jkf });
        dispatch({ type: "update_shogi_game", payload: shogi });
      } catch (error) {
        dispatch({
          type: "error",
          payload: `棋譜の初期化に失敗しました: ${error}`,
        });
      }
    },
    [initializeShogiFromJKF],
  );

  const goToMove = useCallback(
    (index: number) => {
      if (!state.originalJKF) return;
      try {
        // index手目まで進める
        const { shogi, lastMove } = applyShogiMovesToIndex(
          state.originalJKF,
          index,
        );
        dispatch({ type: "update_shogi_game", payload: shogi });
        dispatch({ type: "go_to_move", payload: { index, lastMove } });
      } catch (error) {
        dispatch({
          type: "error",
          payload: `手の移動に失敗しました: ${error}`,
        });
      }
    },
    [state.originalJKF, applyShogiMovesToIndex],
  );

  const nextMove = useCallback(() => {
    if (!state.originalJKF) return;

    const actualMoveCount = getActualMoveCount(state.originalJKF);
    if (state.currentMoveIndex >= actualMoveCount) {
      console.log("nextMove: already at final move, ignoring");
      return;
    }

    const nextIndex = state.currentMoveIndex + 1;
    goToMove(nextIndex);
  }, [state.currentMoveIndex, state.originalJKF, goToMove, getActualMoveCount]);

  const prevMove = useCallback(() => {
    const prevIndex = Math.max(state.currentMoveIndex - 1, 0);
    goToMove(prevIndex);
  }, [state.currentMoveIndex, goToMove]);

  const resetToInitial = useCallback(() => {
    goToMove(0);
  }, [goToMove]);

  const selectSquare = useCallback((x: number, y: number) => {
    dispatch({ type: "select_square", payload: { x, y } });
  }, []);

  const selectHand = useCallback((color: Color, kind: Kind) => {
    dispatch({ type: "select_hand", payload: { color, kind } });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: "clear_selection" });
  }, []);

  const getCurrentBoard = useCallback(() => {
    return state.shogiGame?.board || null;
  }, [state.shogiGame]);

  const getCurrentHands = useCallback(() => {
    return state.shogiGame?.hands || null;
  }, [state.shogiGame]);

  const getCurrentTurn = useCallback(() => {
    return state.shogiGame?.turn ?? null;
  }, [state.shogiGame]);

  // 棋譜再生用メソッド
  const goToStart = useCallback(() => {
    goToMove(0);
  }, [goToMove]);

  const goToEnd = useCallback(() => {
    if (!state.originalJKF) return;
    const actualMoveCount = getActualMoveCount(state.originalJKF);
    goToMove(actualMoveCount);
  }, [state.originalJKF, goToMove, getActualMoveCount]);

  // プロパティ（実際の手数のみを対象とする）
  const totalMoves = state.originalJKF
    ? getActualMoveCount(state.originalJKF)
    : 0;
  const canGoBack = state.currentMoveIndex > 0;
  const canGoForward = state.currentMoveIndex < totalMoves;

  return (
    <GameContext.Provider
      value={{
        ...state,
        initializeFromJKF,
        goToMove,
        nextMove,
        prevMove,
        resetToInitial,
        goToStart,
        goToEnd,
        selectSquare,
        selectHand,
        clearSelection,
        getCurrentBoard,
        getCurrentHands,
        getCurrentTurn,
        totalMoves,
        canGoBack,
        canGoForward,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within GameProvider");
  }
  return context;
}

export { GameProvider, useGame };
