import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { GameService } from "@/services/game/GameService";
import type {
  GameState,
  GameMode,
  SelectedPosition,
  GameProgress,
} from "@/types/state";
import type {
  JKFData,
  Shogi,
  ShogiMove,
  JKFBranchPath,
  Color,
  Kind,
  KifuFormat,
  BranchNavigationInfo,
} from "@/types";
import type { KifuWriter } from "@/interfaces";

export type GameContextState = GameState;

export interface Operation {
  success: boolean;
  error?: string;
}

// ファイル保存のオプション
export interface SaveOptions {
  filePath: string;
  format: KifuFormat;
  autoSave?: boolean;
}

// 手の実行オプション
export interface MakeMoveOptions {
  promote?: boolean;
  saveToFile?: boolean;
  saveOptions?: SaveOptions;
}

// 操作関数の型定義
export interface GameOperations {
  // ゲーム読み込み・初期化
  loadGame: (jkf: JKFData) => Promise<void>;

  // ナビゲーション
  goToIndex: (index: number) => void;
  nextMove: () => void;
  previousMove: () => void;
  goToStart: () => void;
  goToEnd: () => void;

  // 選択・駒操作
  selectSquare: (x: number, y: number) => void;
  selectHand: (color: Color, kind: Kind) => void;
  clearSelection: () => void;
  makeMove: (move: ShogiMove, options?: MakeMoveOptions) => Promise<void>;

  // 棋譜編集
  addComment: (comment: string, options?: SaveOptions) => Promise<void>;
  addSpecial: (special: string, options?: SaveOptions) => Promise<void>;

  // 分岐操作
  switchToBranch: (branchPath: JKFBranchPath) => void;
  createBranch: (move: ShogiMove, options?: SaveOptions) => Promise<void>;
  deleteBranch: (options?: SaveOptions) => Promise<void>;

  // ファイル保存
  saveToFile: (options: SaveOptions) => Promise<void>;

  // モード・エラー管理
  setMode: (mode: GameMode) => void;
  clearError: () => void;
}

// 便利な状態取得・判定関数の型定義
export interface GameHelpers {
  // 基本的な状態チェック
  isGameLoaded: () => boolean;
  isAtStart: () => boolean;
  isAtEnd: () => boolean;
  hasNextMove: () => boolean;
  hasPreviousMove: () => boolean;

  // ゲーム状態の取得
  getCurrentTurn: () => Color | null;
  getCurrentMoveIndex: () => number;
  getTotalMoves: () => number;
  getBranchDepth: () => number;

  // 合法手関連
  getLegalMoves: () => ShogiMove[];
  canMakeMove: (move: ShogiMove) => boolean;
  canPromote: (move: ShogiMove) => boolean;
  mustPromote: (move: ShogiMove) => boolean;

  // 王手・詰み判定
  isInCheck: (color?: Color) => boolean;
  isCheckmate: (color?: Color) => boolean;

  // 分岐関連
  hasAvailableBranches: () => boolean;
  canSwitchToBranch: (branchPath: JKFBranchPath) => boolean;
  isMainBranch: () => boolean;

  // 選択関連
  hasSelection: () => boolean;
  getSelectedPosition: () => SelectedPosition | null;
  isSquareSelected: (x: number, y: number) => boolean;
  isHandSelected: (color: Color, kind: Kind) => boolean;
}

// メインのGameContextインターフェース
export interface GameContextType {
  // 現在の状態
  state: GameContextState;

  // 操作関数群
  operations: GameOperations;

  // 便利な状態取得・判定関数群
  helpers: GameHelpers;
}

// Providerのprops型
export interface GameProviderProps {
  children: ReactNode;
  // 依存関係の注入
  gameService: GameService;
  kifuWriter: KifuWriter;
}
//
// Reducer用のアクション型
export type GameAction =
  // ローディング状態の管理
  | { type: "set_loading"; payload: boolean }
  | { type: "set_error"; payload: string | null }
  | { type: "clear_error" }

  // ゲーム初期化・完全更新
  | {
      type: "initialize_game";
      payload: {
        originalJKF: JKFData;
        shogiGame: Shogi;
        progress: GameProgress;
        branchNavigation: BranchNavigationInfo;
      };
    }
  | { type: "reset_game" }

  // JKFデータ更新（編集後）
  | { type: "update_jkf"; payload: JKFData }

  // 盤面状態更新
  | { type: "update_shogi_game"; payload: Shogi }

  // 進行状況・ナビゲーション更新
  | { type: "update_progress"; payload: GameProgress }
  | { type: "update_branch_navigation"; payload: BranchNavigationInfo }
  | {
      type: "update_navigation";
      payload: {
        progress: GameProgress;
        branchNavigation: BranchNavigationInfo;
      };
    }

  // 選択状態の管理
  | {
      type: "update_selection";
      payload: {
        selectedPosition: SelectedPosition | null;
        legalMoves: ShogiMove[];
      };
    }
  | { type: "clear_selection" }

  // 手の記録
  | { type: "set_last_move"; payload: ShogiMove | null }

  // モード変更
  | { type: "set_mode"; payload: GameMode }

  // 部分的な状態更新（複数プロパティ同時更新）
  | { type: "partial_update"; payload: Partial<GameContextState> };

// 初期状態
const initialState: GameContextState = {
  // JKFデータ
  originalJKF: null,

  // 盤面状態
  shogiGame: null,

  // UI状態
  selectedPosition: null,
  legalMoves: [],
  lastMove: null,
  mode: "replay",

  // 進行状況
  progress: {
    currentJKFIndex: 0,
    actualMoveCount: 0,
    currentBranchPath: {
      mainMoveIndex: 0,
      forkHistory: [],
    },
    totalMovesInBranch: 0,
    isAtBranchEnd: true,
  },

  // 分岐情報
  branchNavigation: {
    currentPath: {
      mainMoveIndex: 0,
      forkHistory: [],
    },
    availableBranches: [],
    branchDepth: 0,
  },

  // システム状態
  isLoading: false,
  error: null,
};

// Reducer関数
function gameReducer(
  state: GameContextState,
  action: GameAction,
): GameContextState {
  switch (action.type) {
    // ローディング・エラー管理
    case "set_loading":
      return { ...state, isLoading: action.payload };

    case "set_error":
      return { ...state, error: action.payload, isLoading: false };

    case "clear_error":
      return { ...state, error: null };

    // ゲーム初期化・リセット
    case "initialize_game":
      return {
        ...state,
        originalJKF: action.payload.originalJKF,
        shogiGame: action.payload.shogiGame,
        progress: action.payload.progress,
        branchNavigation: action.payload.branchNavigation,
        selectedPosition: null,
        legalMoves: [],
        lastMove: null,
        isLoading: false,
        error: null,
      };

    case "reset_game":
      return initialState;

    // データ更新
    case "update_jkf":
      return { ...state, originalJKF: action.payload };

    case "update_shogi_game":
      return { ...state, shogiGame: action.payload };

    // ナビゲーション更新
    case "update_progress":
      return { ...state, progress: action.payload };

    case "update_branch_navigation":
      return { ...state, branchNavigation: action.payload };

    case "update_navigation":
      return {
        ...state,
        progress: action.payload.progress,
        branchNavigation: action.payload.branchNavigation,
      };

    // 選択状態管理
    case "update_selection":
      return {
        ...state,
        selectedPosition: action.payload.selectedPosition,
        legalMoves: action.payload.legalMoves,
      };

    case "clear_selection":
      return {
        ...state,
        selectedPosition: null,
        legalMoves: [],
      };

    // その他
    case "set_last_move":
      return { ...state, lastMove: action.payload };

    case "set_mode":
      return { ...state, mode: action.payload };

    case "partial_update":
      return { ...state, ...action.payload };

    default:
      return state;
  }
}

// Context作成
const GameContext = createContext<GameContextType | null>(null);

// エラーハンドリングヘルパー
const withErrorHandling = (
  dispatch: React.Dispatch<GameAction>,
  operation: () => void,
) => {
  try {
    operation();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    dispatch({ type: "set_error", payload: errorMessage });
  }
};

const withAsyncErrorHandling = async (
  dispatch: React.Dispatch<GameAction>,
  operation: () => Promise<void>,
) => {
  try {
    dispatch({ type: "set_loading", payload: true });
    await operation();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    dispatch({ type: "set_error", payload: errorMessage });
  } finally {
    dispatch({ type: "set_loading", payload: false });
  }
};

// Provider実装
export function GameProvider({
  children,
  gameService,
  kifuWriter,
}: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  // ゲーム読み込み・初期化
  const loadGame = useCallback(
    async (jkf: JKFData) => {
      await withAsyncErrorHandling(dispatch, async () => {
        const result = await gameService.editor.loadGame(jkf);
        if (!result.success) {
          throw new Error(result.error);
        }
        const currentState = gameService.state.getCurrentState();
        dispatch({
          type: "initialize_game",
          payload: {
            originalJKF: currentState.originalJKF!,
            shogiGame: currentState.shogiGame!,
            progress: currentState.progress,
            branchNavigation: currentState.branchNavigation,
          },
        });
      });
    },
    [gameService],
  );

  // ナビゲーション: goToIndex
  const goToIndex = useCallback(
    (index: number) => {
      withErrorHandling(dispatch, () => {
        const result = gameService.state.goToJKFIndex(index);
        if (!result.success) {
          throw new Error(result.error);
        }
        dispatch({
          type: "update_navigation",
          payload: {
            progress: result.data.progress,
            branchNavigation: result.data.branchNavigation,
          },
        });
        dispatch({ type: "clear_selection" });
      });
    },
    [gameService],
  );

  // ナビゲーション: nextMove
  const nextMove = useCallback(() => {
    withErrorHandling(dispatch, () => {
      const result = gameService.state.nextElement();
      if (!result.success) {
        throw new Error(result.error);
      }
      dispatch({
        type: "update_navigation",
        payload: {
          progress: result.data.progress,
          branchNavigation: result.data.branchNavigation,
        },
      });
      dispatch({ type: "clear_selection" });
    });
  }, [gameService]);

  // ナビゲーション: previousMove
  const previousMove = useCallback(() => {
    withErrorHandling(dispatch, () => {
      const result = gameService.state.previousElement();
      if (!result.success) {
        throw new Error(result.error);
      }
      dispatch({
        type: "update_navigation",
        payload: {
          progress: result.data.progress,
          branchNavigation: result.data.branchNavigation,
        },
      });
      dispatch({ type: "clear_selection" });
    });
  }, [gameService]);

  // ナビゲーション: goToStart
  const goToStart = useCallback(() => {
    withErrorHandling(dispatch, () => {
      const result = gameService.state.goToStart();
      if (!result.success) {
        throw new Error(result.error);
      }
      dispatch({
        type: "update_navigation",
        payload: {
          progress: result.data.progress,
          branchNavigation: result.data.branchNavigation,
        },
      });
      dispatch({ type: "clear_selection" });
    });
  }, [gameService]);

  // ナビゲーション: goToEnd
  const goToEnd = useCallback(() => {
    withErrorHandling(dispatch, () => {
      const result = gameService.state.goToEnd();
      if (!result.success) {
        throw new Error(result.error);
      }
      dispatch({
        type: "update_navigation",
        payload: {
          progress: result.data.progress,
          branchNavigation: result.data.branchNavigation,
        },
      });
      dispatch({ type: "clear_selection" });
    });
  }, [gameService]);

  // 選択・駒操作: selectSquare
  const selectSquare = useCallback(
    (x: number, y: number) => {
      if (!state.shogiGame) return;
      withErrorHandling(dispatch, () => {
        gameService.selection.selectSquare({ x, y });
        const legalMoves = gameService.validator.getLegalMovesFrom(
          state.shogiGame!,
          x,
          y,
        );
        dispatch({
          type: "update_selection",
          payload: {
            selectedPosition: { type: "square", x, y },
            legalMoves,
          },
        });
      });
    },
    [gameService, state.shogiGame],
  );

  // 選択・駒操作: selectHand
  const selectHand = useCallback(
    (color: Color, kind: Kind) => {
      if (!state.shogiGame) return;
      withErrorHandling(dispatch, () => {
        gameService.selection.selectHand(color, kind);
        const legalMoves = gameService.validator.getLegalDropsByKind(
          state.shogiGame!,
          color,
          kind,
        );
        dispatch({
          type: "update_selection",
          payload: {
            selectedPosition: { type: "hand", color, kind },
            legalMoves,
          },
        });
      });
    },
    [gameService, state.shogiGame],
  );

  // 選択・駒操作: clearSelection
  const clearSelection = useCallback(() => {
    gameService.selection.clearSelection();
    dispatch({ type: "clear_selection" });
  }, [gameService]);

  // 選択・駒操作: makeMove
  const makeMove = useCallback(
    async (move: ShogiMove, options?: MakeMoveOptions) => {
      if (!state.shogiGame || !state.originalJKF) return;

      await withAsyncErrorHandling(dispatch, async () => {
        // 手を実行
        const result = gameService.editor.makeMove(move, options?.promote);
        if (!result.success) {
          throw new Error(result.error);
        }

        // 状態を更新
        const newState = gameService.state.getCurrentState();
        dispatch({
          type: "partial_update",
          payload: {
            originalJKF: newState.originalJKF,
            shogiGame: newState.shogiGame,
            progress: newState.progress,
            branchNavigation: newState.branchNavigation,
            lastMove: move,
            selectedPosition: null,
            legalMoves: [],
          },
        });

        // ファイル保存（オプション）
        if (options?.saveToFile && options.saveOptions) {
          const saveResult = await kifuWriter.writeToFile(
            newState.originalJKF!,
            options.saveOptions.filePath,
            options.saveOptions.format,
          );
          if (!saveResult.success) {
            throw new Error(saveResult.error);
          }
        }
      });
    },
    [gameService, kifuWriter, state.shogiGame, state.originalJKF],
  );

  // 棋譜編集: addComment
  const addComment = useCallback(
    async (comment: string, options?: SaveOptions) => {
      if (!state.originalJKF) return;

      await withAsyncErrorHandling(dispatch, async () => {
        // コメントを追加
        const result = gameService.editor.addComment(
          comment,
          state.progress.currentJKFIndex,
          state.progress.currentBranchPath,
        );
        if (!result.success) {
          throw new Error(result.error);
        }

        // JKFデータを更新
        const newState = gameService.state.getCurrentState();
        dispatch({
          type: "update_jkf",
          payload: newState.originalJKF!,
        });

        // ファイル保存（オプション）
        if (options) {
          const saveResult = await kifuWriter.writeToFile(
            newState.originalJKF!,
            options.filePath,
            options.format,
          );
          if (!saveResult.success) {
            throw new Error(saveResult.error);
          }
        }
      });
    },
    [gameService, kifuWriter, state.originalJKF, state.progress],
  );

  // 棋譜編集: addSpecial
  const addSpecial = useCallback(
    async (special: string, options?: SaveOptions) => {
      if (!state.originalJKF) return;

      await withAsyncErrorHandling(dispatch, async () => {
        // 特殊記号を追加
        const result = gameService.editor.addSpecial(
          special,
          state.progress.currentJKFIndex,
          state.progress.currentBranchPath,
        );
        if (!result.success) {
          throw new Error(result.error);
        }

        // JKFデータを更新
        const newState = gameService.state.getCurrentState();
        dispatch({
          type: "update_jkf",
          payload: newState.originalJKF!,
        });

        // ファイル保存（オプション）
        if (options) {
          const saveResult = await kifuWriter.writeToFile(
            newState.originalJKF!,
            options.filePath,
            options.format,
          );
          if (!saveResult.success) {
            throw new Error(saveResult.error);
          }
        }
      });
    },
    [gameService, kifuWriter, state.originalJKF, state.progress],
  );

  // 分岐操作: switchToBranch
  const switchToBranch = useCallback(
    (branchPath: JKFBranchPath) => {
      withErrorHandling(dispatch, () => {
        const result = gameService.branch.switchToBranch(branchPath);
        if (!result.success) {
          throw new Error(result.error);
        }

        // 状態を更新
        const newState = gameService.state.getCurrentState();
        dispatch({
          type: "update_navigation",
          payload: {
            progress: newState.progress,
            branchNavigation: newState.branchNavigation,
          },
        });
        dispatch({ type: "clear_selection" });
      });
    },
    [gameService],
  );

  // 分岐操作: createBranch
  const createBranch = useCallback(
    async (move: ShogiMove, options?: SaveOptions) => {
      if (!state.originalJKF) return;

      await withAsyncErrorHandling(dispatch, async () => {
        // 分岐を作成
        const result = gameService.branch.createBranch(move);
        if (!result.success) {
          throw new Error(result.error);
        }

        // 状態を更新
        const newState = gameService.state.getCurrentState();
        dispatch({
          type: "partial_update",
          payload: {
            originalJKF: newState.originalJKF,
            shogiGame: newState.shogiGame,
            progress: newState.progress,
            branchNavigation: newState.branchNavigation,
            lastMove: move,
            selectedPosition: null,
            legalMoves: [],
          },
        });

        // ファイル保存（オプション）
        if (options) {
          const saveResult = await kifuWriter.writeToFile(
            newState.originalJKF!,
            options.filePath,
            options.format,
          );
          if (!saveResult.success) {
            throw new Error(saveResult.error);
          }
        }
      });
    },
    [gameService, kifuWriter, state.originalJKF],
  );

  // 分岐操作: deleteBranch
  const deleteBranch = useCallback(
    async (options?: SaveOptions) => {
      if (!state.originalJKF) return;

      await withAsyncErrorHandling(dispatch, async () => {
        // 分岐を削除
        const result = gameService.branch.deleteBranch();
        if (!result.success) {
          throw new Error(result.error);
        }

        // 状態を更新
        const newState = gameService.state.getCurrentState();
        dispatch({
          type: "partial_update",
          payload: {
            originalJKF: newState.originalJKF,
            shogiGame: newState.shogiGame,
            progress: newState.progress,
            branchNavigation: newState.branchNavigation,
            selectedPosition: null,
            legalMoves: [],
          },
        });

        // ファイル保存（オプション）
        if (options) {
          const saveResult = await kifuWriter.writeToFile(
            newState.originalJKF!,
            options.filePath,
            options.format,
          );
          if (!saveResult.success) {
            throw new Error(saveResult.error);
          }
        }
      });
    },
    [gameService, kifuWriter, state.originalJKF, state.progress],
  );

  // ファイル保存: saveToFile
  const saveToFile = useCallback(
    async (options: SaveOptions) => {
      if (!state.originalJKF) return;

      await withAsyncErrorHandling(dispatch, async () => {
        const saveResult = await kifuWriter.writeToFile(
          state.originalJKF!,
          options.filePath,
          options.format,
        );
        if (!saveResult.success) {
          throw new Error(saveResult.error);
        }
      });
    },
    [kifuWriter, state.originalJKF],
  );

  // モード・エラー管理: setMode
  const setMode = useCallback(
    (mode: GameMode) => {
      gameService.mode.setMode(mode);
      dispatch({ type: "set_mode", payload: mode });
    },
    [gameService],
  );

  // モード・エラー管理: clearError
  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  // 操作関数をまとめるオブジェクト
  const operations: GameOperations = useMemo(
    () => ({
      // ゲーム読み込み・初期化
      loadGame,

      // ナビゲーション
      goToIndex,
      nextMove,
      previousMove,
      goToStart,
      goToEnd,

      // 選択・駒操作
      selectSquare,
      selectHand,
      clearSelection,
      makeMove,

      // 棋譜編集
      addComment,
      addSpecial,

      // 分岐操作
      switchToBranch,
      createBranch,
      deleteBranch,

      // ファイル保存
      saveToFile,

      // モード・エラー管理
      setMode,
      clearError,
    }),
    [
      loadGame,
      goToIndex,
      nextMove,
      previousMove,
      goToStart,
      goToEnd,
      selectSquare,
      selectHand,
      clearSelection,
      makeMove,
      addComment,
      addSpecial,
      switchToBranch,
      createBranch,
      deleteBranch,
      saveToFile,
      setMode,
      clearError,
    ],
  );
  // 便利な状態取得・判定関数をまとめるオブジェクト
  const helpers: GameHelpers = useMemo(
    () => ({
      // 基本的な状態チェック
      isGameLoaded: () =>
        state.shogiGame !== null && state.originalJKF !== null,
      isAtStart: () => state.progress.currentJKFIndex === 0,
      isAtEnd: () => state.progress.isAtBranchEnd,
      hasNextMove: () => !state.progress.isAtBranchEnd,
      hasPreviousMove: () => state.progress.currentJKFIndex > 0,

      // ゲーム状態の取得
      getCurrentTurn: () => state.shogiGame?.turn || null,
      getCurrentMoveIndex: () => state.progress.currentJKFIndex,
      getTotalMoves: () => state.progress.totalMovesInBranch,
      getBranchDepth: () => state.branchNavigation.branchDepth,

      // 合法手関連
      getLegalMoves: () => state.legalMoves,
      canMakeMove: (move) => {
        if (!state.shogiGame) return false;
        return gameService.validator.isLegalMove(state.shogiGame, move);
      },
      canPromote: (move) => {
        if (!state.shogiGame) return false;
        return gameService.validator.canPromote(state.shogiGame, move);
      },
      mustPromote: (move) => {
        if (!state.shogiGame) return false;
        return gameService.validator.mustPromote(state.shogiGame, move);
      },

      // 王手・詰み判定
      isInCheck: (color) => {
        if (!state.shogiGame) return false;
        const targetColor = color || state.shogiGame.turn;
        return state.shogiGame.isCheck(targetColor);
      },
      isCheckmate: (color) => {
        // TODO: isCheckmateの実装が必要
        return false;
      },

      // 分岐関連
      hasAvailableBranches: () =>
        state.branchNavigation.availableBranches.length > 0,
      canSwitchToBranch: (branchPath) => {
        // TODO: canSwitchToBranchの実装が必要
        return true;
      },
      isMainBranch: () =>
        state.progress.currentBranchPath.forkHistory.length === 0,

      // 選択関連
      hasSelection: () => state.selectedPosition !== null,
      getSelectedPosition: () => state.selectedPosition,
      isSquareSelected: (x, y) => {
        return (
          state.selectedPosition?.type === "square" &&
          state.selectedPosition.x === x &&
          state.selectedPosition.y === y
        );
      },
      isHandSelected: (color, kind) => {
        return (
          state.selectedPosition?.type === "hand" &&
          state.selectedPosition.color === color &&
          state.selectedPosition.kind === kind
        );
      },
    }),
    [state, gameService],
  );

  // 最終的なコンテキスト値
  const contextValue: GameContextType = useMemo(
    () => ({
      state,
      operations,
      helpers,
    }),
    [state, operations, helpers],
  );

  return (
    <GameContext.Provider value={contextValue}>{children}</GameContext.Provider>
  );
}

// Custom Hook
export function useGame(): GameContextType {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
}
