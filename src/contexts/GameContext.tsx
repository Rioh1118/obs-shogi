import {
  createContext,
  useReducer,
  useEffect,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { Color, type Kind, type Piece } from "shogi.js";
import { LegalMoveGenerator } from "../services/LegalMoveGenerator";
import { GameEngine } from "../services/GameEngine";
import type { JKFFormat } from "../types/kifu";
import { useFileTree } from "./FileTreeContext";
import { type GameState, type GameAction } from "../types/game";
import { MoveService } from "../services/MoveService";

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
    case "select_square":
      return {
        ...state,
        selectedPosition: { type: "square", ...action.payload },
        legalMoves: state.shogiGame
          ? LegalMoveGenerator.getLegalMovesFrom(
              state.shogiGame,
              action.payload.x,
              action.payload.y,
            )
          : [],
      };
    case "select_hand":
      return {
        ...state,
        selectedPosition: { type: "hand", ...action.payload },
        legalMoves: state.shogiGame
          ? LegalMoveGenerator.getLegalDropsByKind(
              state.shogiGame,
              action.payload.color,
              action.payload.kind,
            )
          : [],
      };
    case "clear_selection":
      return {
        ...state,
        selectedPosition: null,
        legalMoves: [],
      };
    case "update_shogi_game":
      return {
        ...state,
        shogiGame: action.payload,
      };
    case "apply_move":
      return {
        ...state,
        originalJKF: action.payload.newJkf,
        currentMoveIndex: state.currentMoveIndex + 1,
        selectedPosition: null,
        legalMoves: [],
        lastMove: action.payload.move,
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
  makeMove: (targetSquare: { x: number; y: number }) => Promise<void>;
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
  const { jkfData, selectedNode } = useFileTree();
  const currentFilePath = selectedNode?.path;

  useEffect(() => {
    if (jkfData) {
      try {
        dispatch({ type: "loading" });
        const shogi = GameEngine.initializeFromJKF(jkfData);
        dispatch({ type: "initialize_from_jkf", payload: jkfData });
        dispatch({ type: "update_shogi_game", payload: shogi });
      } catch (error) {
        dispatch({
          type: "error",
          payload: `棋譜の初期化に失敗しました: ${error}`,
        });
      }
    }
  }, [jkfData]);
  const initializeFromJKF = useCallback((jkf: JKFFormat) => {
    try {
      dispatch({ type: "loading" });
      const shogi = GameEngine.initializeFromJKF(jkf);
      dispatch({ type: "initialize_from_jkf", payload: jkf });
      dispatch({ type: "update_shogi_game", payload: shogi });
    } catch (error) {
      dispatch({
        type: "error",
        payload: `棋譜の初期化に失敗しました: ${error}`,
      });
    }
  }, []);

  // 指し手を適用する関数
  const makeMove = useCallback(
    async (targetSquare: { x: number; y: number }) => {
      if (!state.selectedPosition || !state.shogiGame || !state.originalJKF) {
        console.log("makeMove: 必要な状態が不足しています");
        return;
      }

      const targetMove = state.legalMoves.find(
        (move) => move.to.x === targetSquare.x && move.to.y === targetSquare.y,
      );

      if (!targetMove) {
        console.log("makeMove: 合法手ではありません", targetSquare);
        return;
      }

      if (!targetMove) {
        console.log("makeMove: 合法手ではありません", targetSquare);
        return;
      }

      try {
        // 現在の局面をコピーして新しい手を適用
        const { shogi: currentShogi } = GameEngine.applyShogiMovesToIndex(
          state.originalJKF,
          state.currentMoveIndex,
        );

        // 新しい手を適用
        await MoveService.executeMoveOnShogi(
          currentShogi,
          state.selectedPosition,
          targetMove,
          targetSquare,
        );

        const newJkf = MoveService.addMoveToJKF(
          state.originalJKF,
          targetMove,
          state.shogiGame.turn,
        );

        if (currentFilePath && !selectedNode?.isDir) {
          await MoveService.saveToFile(newJkf, currentFilePath);
        }

        // 状態を更新
        dispatch({
          type: "apply_move",
          payload: {
            move: targetMove,
            newJkf,
          },
        });
        dispatch({ type: "update_shogi_game", payload: currentShogi });
      } catch (error) {
        console.error("指し手の適用に失敗:", error);
        dispatch({
          type: "error",
          payload: `指し手の適用に失敗しました: ${error}`,
        });
      }
    },
    [
      state.selectedPosition,
      state.shogiGame,
      state.originalJKF,
      state.legalMoves,
      state.currentMoveIndex,
      currentFilePath,
      selectedNode?.isDir,
    ],
  );

  const goToMove = useCallback(
    (index: number) => {
      if (!state.originalJKF) return;
      try {
        // index手目まで進める
        const { shogi, lastMove } = GameEngine.applyShogiMovesToIndex(
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
    [state.originalJKF],
  );

  const nextMove = useCallback(() => {
    if (!state.originalJKF) return;

    const actualMoveCount = GameEngine.getActualMoveCount(state.originalJKF);
    if (state.currentMoveIndex >= actualMoveCount) {
      console.log("nextMove: already at final move, ignoring");
      return;
    }

    const nextIndex = state.currentMoveIndex + 1;
    goToMove(nextIndex);
  }, [state.currentMoveIndex, state.originalJKF, goToMove]);

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

  const getCurrentTurn = useCallback(() => {
    return state.shogiGame?.turn ?? null;
  }, [state.shogiGame]);

  const getCurrentBoard = useCallback(() => {
    return state.shogiGame?.board || null;
  }, [state.shogiGame]);

  const getCurrentHands = useCallback(() => {
    return state.shogiGame?.hands || null;
  }, [state.shogiGame]);

  // 棋譜再生用メソッド
  const goToStart = useCallback(() => {
    goToMove(0);
  }, [goToMove]);

  const goToEnd = useCallback(() => {
    if (!state.originalJKF) return;
    const actualMoveCount = GameEngine.getActualMoveCount(state.originalJKF);
    goToMove(actualMoveCount);
  }, [state.originalJKF, goToMove]);

  // プロパティ（実際の手数のみを対象とする）
  const totalMoves = state.originalJKF
    ? GameEngine.getActualMoveCount(state.originalJKF)
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
        makeMove,
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
