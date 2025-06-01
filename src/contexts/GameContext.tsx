import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { GameStateManager } from "../services/GameStateManager";
import { useFileTree } from "./FileTreeContext";
import type {
  GameState,
  GameAction,
  GameOperations,
  JKFBranchPath,
} from "../types/game";
import { Color, type Kind, type IMove } from "shogi.js";
import type { IJSONKifuFormat as JKFFormat } from "json-kifu-format/dist/src/Formats";
import { MoveService } from "../services/MoveService";

// 初期状態
const initialState: GameState = {
  originalJKF: null,
  currentMoveIndex: 0,
  currentBranchPath: { mainMoveIndex: 0, forkHistory: [] },
  shogiGame: null,
  selectedPosition: null,
  legalMoves: [],
  lastMove: null,
  mode: "replay",
  progress: {
    currentJKFIndex: 0,
    actualMoveCount: 0,
    currentBranchPath: { mainMoveIndex: 0, forkHistory: [] },
    totalMovesInBranch: 0,
    isAtBranchEnd: true,
  },
  branchNavigation: {
    currentPath: { mainMoveIndex: 0, forkHistory: [] },
    availableBranches: [],
    branchDepth: 0,
  },
  isLoading: false,
  error: null,
};

// Reducer
function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "loading":
      return {
        ...state,
        isLoading: true,
        error: null,
      };

    case "error":
      return {
        ...state,
        isLoading: false,
        error: action.payload,
      };

    case "clear_error":
      return {
        ...state,
        error: null,
      };

    case "initialize_from_jkf":
      return {
        ...state,
        originalJKF: action.payload,
        currentMoveIndex: 0,
        shogiGame: action.payload ? state.shogiGame : null,
        currentBranchPath: { mainMoveIndex: 0, forkHistory: [] },
        selectedPosition: null,
        legalMoves: [],
        lastMove: null,
        progress: {
          currentJKFIndex: 0,
          actualMoveCount: 0,
          currentBranchPath: { mainMoveIndex: 0, forkHistory: [] },
          totalMovesInBranch: 0,
          isAtBranchEnd: true,
        },
        branchNavigation: {
          currentPath: { mainMoveIndex: 0, forkHistory: [] },
          availableBranches: [],
          branchDepth: 0,
        },
        isLoading: false,
        error: null,
      };

    case "update_shogi_game":
      return {
        ...state,
        shogiGame: action.payload,
        isLoading: false,
      };

    case "go_to_jkf_index":
      return {
        ...state,
        currentMoveIndex: action.payload.jkfIndex,
        currentBranchPath: action.payload.branchPath,
        lastMove: action.payload.lastMove,
        progress: action.payload.progress,
        branchNavigation: action.payload.branchNavigation,
        selectedPosition: null,
        legalMoves: [],
        isLoading: false,
      };

    case "select_square":
      return {
        ...state,
        selectedPosition: {
          type: "square",
          x: action.payload.x,
          y: action.payload.y,
        },
      };

    case "select_hand":
      return {
        ...state,
        selectedPosition: {
          type: "hand",
          color: action.payload.color,
          kind: action.payload.kind,
        },
      };

    case "clear_selection":
      return {
        ...state,
        selectedPosition: null,
        legalMoves: [],
      };

    case "update_legal_moves":
      return {
        ...state,
        legalMoves: action.payload,
      };

    case "apply_move":
      return {
        ...state,
        originalJKF: action.payload.newJkf,
        currentBranchPath: action.payload.newBranchPath,
        lastMove: action.payload.move,
        progress: action.payload.progress,
        branchNavigation: action.payload.branchNavigation,
        selectedPosition: null,
        legalMoves: [],
        isLoading: false,
      };

    case "add_comment":
      return {
        ...state,
        originalJKF: action.payload.newJkf,
        currentMoveIndex: action.payload.jkfIndex,
        isLoading: false,
      };

    case "add_special":
      return {
        ...state,
        originalJKF: action.payload.newJkf,
        currentMoveIndex: action.payload.jkfIndex,
        isLoading: false,
      };

    case "switch_to_branch":
      return {
        ...state,
        currentBranchPath: action.payload.branchPath,
        currentMoveIndex: action.payload.jkfIndex,
        progress: action.payload.progress,
        branchNavigation: action.payload.branchNavigation,
        selectedPosition: null,
        legalMoves: [],
        isLoading: false,
      };

    case "create_branch":
      return {
        ...state,
        originalJKF: action.payload.newJkf,
        currentBranchPath: action.payload.newBranchPath,
        lastMove: action.payload.move,
        selectedPosition: null,
        legalMoves: [],
        isLoading: false,
      };
    // case "delete_branch":
    //   return {
    //     ...state,
    //     originalJKF: action.payload.newJkf,
    //     currentBranchPath: action.payload.newBranchPath,
    //     currentMoveIndex: action.payload.jkfIndex,
    //     progress: action.payload.progress,
    //     branchNavigation: action.payload.branchNavigation,
    //     selectedPosition: null,
    //     legalMoves: [],
    //     isLoading: false,
    //   };
    case "set_mode":
      return {
        ...state,
        mode: action.payload,
        selectedPosition: null,
        legalMoves: [],
      };

    default:
      return state;
  }
}

interface GameContextType {
  state: GameState;
  operations: GameOperations;

  isGameLoaded: () => boolean;
  getCurrentTurn: () => Color | null;
  hasNextMove: () => boolean;
  hasPreviousMove: () => boolean;
  getLegalMoves: () => IMove[];
  isInCheck: (color?: Color) => boolean;
  canMakeMove: (move: IMove) => boolean;
}

// Context
const GameContext = createContext<GameContextType | null>(null);

// Provider
interface GameProviderProps {
  children: ReactNode;
}

export function GameProvider({ children }: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const { jkfData, selectedNode, isKifuSelected } = useFileTree();

  const withSyncErrorHandling = useCallback((operation: () => void) => {
    try {
      dispatch({ type: "loading" });
      operation();
    } catch (error) {
      dispatch({
        type: "error",
        payload:
          error instanceof Error ? error.message : "不明なエラーが発生しました",
      });
    }
  }, []);

  // ヘルパー関数：非同期処理用エラーハンドリング
  const withAsyncErrorHandling = useCallback(
    async (operation: () => Promise<void>) => {
      try {
        dispatch({ type: "loading" });
        await operation();
      } catch (error) {
        dispatch({
          type: "error",
          payload:
            error instanceof Error
              ? error.message
              : "不明なエラーが発生しました",
        });
      }
    },
    [],
  );

  // JKFからゲームを初期化する内部関数
  const loadGameFromJKF = useCallback(
    (jkf: JKFFormat) => {
      withSyncErrorHandling(() => {
        if (!jkf) {
          throw new Error("JKFデータが無効です");
        }

        dispatch({ type: "initialize_from_jkf", payload: jkf });

        // 初期状態を構築
        const gameState = GameStateManager.goToStart(jkf);
        if (gameState.success && gameState.shogiGame) {
          dispatch({ type: "update_shogi_game", payload: gameState.shogiGame });
          dispatch({
            type: "go_to_jkf_index",
            payload: {
              jkfIndex: 0,
              branchPath: { mainMoveIndex: 0, forkHistory: [] },
              lastMove: null,
              progress: gameState.progress!,
              branchNavigation: gameState.branchNavigation!,
            },
          });
        } else {
          throw new Error(gameState.error || "ゲームの初期化に失敗しました");
        }
      });
    },
    [withSyncErrorHandling],
  );

  // FileTreeContextからJKFデータが変更された時の自動ロード
  useEffect(() => {
    if (isKifuSelected() && jkfData) {
      loadGameFromJKF(jkfData);
    } else {
      // 棋譜ファイル以外が選択された場合はゲーム状態をクリア
      dispatch({ type: "initialize_from_jkf", payload: null });
    }
  }, [jkfData, selectedNode, isKifuSelected, loadGameFromJKF]);

  // ヘルパー関数：同期処理用エラーハンドリング

  // 基本操作
  const loadGame = useCallback(
    (jkf: JKFFormat) => {
      loadGameFromJKF(jkf);
    },
    [loadGameFromJKF],
  );

  // JKFナビゲーション
  const goToJKFIndex = useCallback(
    (index: number) => {
      if (!state.originalJKF) return;

      withSyncErrorHandling(() => {
        const result = GameStateManager.goToIndex(
          state.originalJKF!,
          index,
          state.currentBranchPath,
        );

        if (result.success && result.shogiGame) {
          dispatch({ type: "update_shogi_game", payload: result.shogiGame });
          dispatch({
            type: "go_to_jkf_index",
            payload: {
              jkfIndex: index,
              branchPath: state.currentBranchPath,
              lastMove: result.lastMove || null,
              progress: result.progress!,
              branchNavigation: result.branchNavigation!,
            },
          });
        } else {
          throw new Error(result.error || "インデックスへの移動に失敗しました");
        }
      });
    },
    [state.originalJKF, state.currentBranchPath, withSyncErrorHandling],
  );

  const goToJKFIndexWithBranch = useCallback(
    (index: number, branchPath: JKFBranchPath) => {
      if (!state.originalJKF) return;

      withSyncErrorHandling(() => {
        const result = GameStateManager.goToIndex(
          state.originalJKF!,
          index,
          branchPath,
        );

        if (result.success && result.shogiGame) {
          dispatch({ type: "update_shogi_game", payload: result.shogiGame });
          dispatch({
            type: "go_to_jkf_index",
            payload: {
              jkfIndex: index,
              branchPath,
              lastMove: result.lastMove || null,
              progress: result.progress!,
              branchNavigation: result.branchNavigation!,
            },
          });
        } else {
          throw new Error(result.error || "分岐への移動に失敗しました");
        }
      });
    },
    [state.originalJKF, withSyncErrorHandling],
  );

  const nextElement = useCallback(() => {
    console.log("nextElement called", {
      hasJKF: !!state.originalJKF,
      currentIndex: state.currentMoveIndex,
      branchPath: state.currentBranchPath,
    });

    if (!state.originalJKF) return;
    console.log("JKF moves:", state.originalJKF.moves);
    console.log(
      "Next move data:",
      state.originalJKF.moves[state.currentMoveIndex + 1],
    );

    withSyncErrorHandling(() => {
      const result = GameStateManager.goToNext(
        state.originalJKF!,
        state.currentMoveIndex,
        state.currentBranchPath,
      );

      if (result.success && result.shogiGame) {
        console.log("Dispatching updates...");
        dispatch({ type: "update_shogi_game", payload: result.shogiGame });
        dispatch({
          type: "go_to_jkf_index",
          payload: {
            jkfIndex: state.currentMoveIndex + 1,
            branchPath: state.currentBranchPath,
            lastMove: result.lastMove || null,
            progress: result.progress!,
            branchNavigation: result.branchNavigation!,
          },
        });
      } else {
        // 次の手がない場合はエラーにしない
        if (result.error?.includes("次の手がありません")) {
          return;
        }
        throw new Error(result.error || "次の要素への移動に失敗しました");
      }
    });
  }, [
    state.originalJKF,
    state.currentMoveIndex,
    state.currentBranchPath,
    withSyncErrorHandling,
  ]);

  const previousElement = useCallback(() => {
    if (!state.originalJKF) return;

    withSyncErrorHandling(() => {
      const result = GameStateManager.goToPrevious(
        state.originalJKF!,
        state.currentMoveIndex,
        state.currentBranchPath,
      );

      if (state.currentMoveIndex === 1) {
        goToStart();
      }

      if (result.success && result.shogiGame) {
        dispatch({ type: "update_shogi_game", payload: result.shogiGame });
        dispatch({
          type: "go_to_jkf_index",
          payload: {
            jkfIndex: state.currentMoveIndex - 1,
            branchPath: state.currentBranchPath,
            lastMove: result.lastMove || null,
            progress: result.progress!,
            branchNavigation: result.branchNavigation!,
          },
        });
      } else {
        // 前の手がない場合はエラーにしない
        if (result.error?.includes("前の手がありません")) {
          return;
        }
        throw new Error(`${result.error} 前の要素への移動に失敗しました`);
        // throw new Error(result.error || "前の要素への移動に失敗しました");
      }
    });
  }, [
    state.originalJKF,
    state.currentMoveIndex,
    state.currentBranchPath,
    withSyncErrorHandling,
  ]);

  const goToStart = useCallback(() => {
    if (!state.originalJKF) return;

    withSyncErrorHandling(() => {
      const result = GameStateManager.goToStart(state.originalJKF!);

      if (result.success && result.shogiGame) {
        dispatch({ type: "update_shogi_game", payload: result.shogiGame });
        dispatch({
          type: "go_to_jkf_index",
          payload: {
            jkfIndex: 0,
            branchPath: { mainMoveIndex: 0, forkHistory: [] },
            lastMove: null,
            progress: result.progress!,
            branchNavigation: result.branchNavigation!,
          },
        });
      } else {
        throw new Error(result.error || "開始局面への移動に失敗しました");
      }
    });
  }, [state.originalJKF, withSyncErrorHandling]);

  const goToEnd = useCallback(() => {
    if (!state.originalJKF) return;

    withSyncErrorHandling(() => {
      const result = GameStateManager.goToEnd(
        state.originalJKF!,
        state.currentBranchPath,
      );

      if (result.success && result.shogiGame) {
        dispatch({ type: "update_shogi_game", payload: result.shogiGame });
        dispatch({
          type: "go_to_jkf_index",
          payload: {
            jkfIndex: result.progress!.currentJKFIndex,
            branchPath: state.currentBranchPath,
            lastMove: result.lastMove || null,
            progress: result.progress!,
            branchNavigation: result.branchNavigation!,
          },
        });
      } else {
        throw new Error(result.error || "最終手への移動に失敗しました");
      }
    });
  }, [state.originalJKF, state.currentBranchPath, withSyncErrorHandling]);

  // 手の操作（nextMove, previousMoveは nextElement, previousElement と同じ）
  const nextMove = nextElement;
  const previousMove = previousElement;

  // 選択操作
  const selectSquare = useCallback(
    (position: { x: number; y: number }) => {
      if (!state.shogiGame) return;

      withSyncErrorHandling(() => {
        // 既に同じマスが選択されている場合は選択解除
        if (
          state.selectedPosition?.type === "square" &&
          state.selectedPosition.x === position.x &&
          state.selectedPosition.y === position.y
        ) {
          dispatch({ type: "clear_selection" });
          return;
        }

        dispatch({ type: "select_square", payload: position });

        // 合法手を計算
        const result = GameStateManager.calculateLegalMoves(state.shogiGame!, {
          type: "square",
          x: position.x,
          y: position.y,
        });
        if (result.success) {
          dispatch({ type: "update_legal_moves", payload: result.legalMoves });
        }
      });
    },
    [state.shogiGame, state.selectedPosition, withSyncErrorHandling],
  );

  const selectHand = useCallback(
    (color: Color, kind: Kind) => {
      if (!state.shogiGame) return;

      withSyncErrorHandling(() => {
        // 既に同じ持ち駒が選択されている場合は選択解除
        if (
          state.selectedPosition?.type === "hand" &&
          state.selectedPosition.color === color &&
          state.selectedPosition.kind === kind
        ) {
          dispatch({ type: "clear_selection" });
          return;
        }

        dispatch({ type: "select_hand", payload: { color, kind } });

        // 持ち駒の合法手を計算
        const result = GameStateManager.calculateLegalMoves(state.shogiGame!, {
          type: "hand",
          color,
          kind,
        });
        dispatch({ type: "update_legal_moves", payload: result.legalMoves });
      });
    },
    [state.shogiGame, state.selectedPosition, withSyncErrorHandling],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "clear_selection" });
  }, []);

  // 手の実行
  const makeMove = useCallback(
    (move: IMove) => {
      if (!state.originalJKF || !state.shogiGame || !state.selectedPosition)
        return;

      withAsyncErrorHandling(async () => {
        const validation = GameStateManager.validateMove(
          state.shogiGame!,
          move,
        );
        if (!validation.success || !validation.isLegal) {
          throw new Error(validation.error || "不正な手です");
        }

        const result = GameStateManager.executeMove(
          state.originalJKF!,
          state.shogiGame!,
          state.selectedPosition!,
          move.to,
          state.currentMoveIndex,
          state.currentBranchPath,
        );

        if (result.success && result.gameState?.success) {
          dispatch({
            type: "update_shogi_game",
            payload: result.gameState.shogiGame!,
          });
          dispatch({
            type: "apply_move",
            payload: {
              newJkf: result.newJKF!,
              newBranchPath: result.newBranchPath!,
              move,
              progress: result.gameState.progress!,
              branchNavigation: result.gameState.branchNavigation!,
            },
          });

          dispatch({ type: "clear_selection" });

          // ファイルが選択されている場合は保存
          if (selectedNode && !selectedNode.isDir) {
            try {
              await MoveService.saveToFile(result.newJKF!, selectedNode.path);
            } catch (saveError) {
              console.warn("ファイル保存に失敗しました:", saveError);
              // 保存エラーは警告のみで、ゲーム状態は更新済みなのでそのまま続行
            }
          }
        } else {
          throw new Error(result.error || "手の実行に失敗しました");
        }
      });
    },
    [
      state.originalJKF,
      state.shogiGame,
      state.currentMoveIndex,
      state.currentBranchPath,
      state.selectedPosition,
      selectedNode,
      withAsyncErrorHandling,
    ],
  );

  // コメント・特殊情報の追加
  const addComment = useCallback(
    (comment: string) => {
      if (!state.originalJKF) return;

      withAsyncErrorHandling(async () => {
        const result = GameStateManager.addComment(
          state.originalJKF!,
          comment,
          state.currentMoveIndex,
          state.currentBranchPath,
        );

        if (result.success) {
          dispatch({
            type: "add_comment",
            payload: {
              newJkf: result.newJkf!,
              jkfIndex: state.currentMoveIndex,
              comment,
            },
          });

          // ファイル保存
          if (selectedNode && !selectedNode.isDir) {
            try {
              await MoveService.saveToFile(result.newJkf!, selectedNode.path);
            } catch (saveError) {
              console.warn("ファイル保存に失敗しました:", saveError);
            }
          }
        } else {
          throw new Error(result.error || "コメントの追加に失敗しました");
        }
      });
    },
    [
      state.originalJKF,
      state.currentMoveIndex,
      state.currentBranchPath,
      selectedNode,
      withAsyncErrorHandling,
    ],
  );

  const addSpecial = useCallback(
    (special: string) => {
      if (!state.originalJKF) return;

      withAsyncErrorHandling(async () => {
        const result = GameStateManager.addSpecial(
          state.originalJKF!,
          special,
          state.currentMoveIndex,
          state.currentBranchPath,
        );

        if (result.success) {
          dispatch({
            type: "add_special",
            payload: {
              newJkf: result.newJkf!,
              jkfIndex: state.currentMoveIndex,
              special,
            },
          });

          // ファイル保存
          if (selectedNode && !selectedNode.isDir) {
            try {
              await MoveService.saveToFile(result.newJkf!, selectedNode.path);
            } catch (saveError) {
              console.warn("ファイル保存に失敗しました:", saveError);
            }
          }
        } else {
          throw new Error(result.error || "特殊情報の追加に失敗しました");
        }
      });
    },
    [
      state.originalJKF,
      state.currentMoveIndex,
      state.currentBranchPath,
      selectedNode,
      withAsyncErrorHandling,
    ],
  );

  // 分岐操作
  const switchToBranch = useCallback(
    (branchPath: JKFBranchPath) => {
      if (!state.originalJKF) return;

      withSyncErrorHandling(() => {
        const result = GameStateManager.switchToBranch(
          state.originalJKF!,
          branchPath,
        );

        if (result.success && result.shogiGame) {
          dispatch({ type: "update_shogi_game", payload: result.shogiGame });
          dispatch({
            type: "switch_to_branch",
            payload: {
              branchPath,
              jkfIndex: result.progress!.currentJKFIndex,
              progress: result.progress!,
              branchNavigation: result.branchNavigation!,
            },
          });
        } else {
          throw new Error(result.error || "分岐の切り替えに失敗しました");
        }
      });
    },
    [state.originalJKF, withSyncErrorHandling],
  );

  const createBranch = useCallback(
    (move: IMove) => {
      if (!state.originalJKF || !state.shogiGame) return;

      withAsyncErrorHandling(async () => {
        const result = GameStateManager.executeMove(
          state.originalJKF!,
          state.shogiGame!,
          state.selectedPosition!,
          move.to,
          state.currentMoveIndex,
          state.currentBranchPath,
        );

        if (result.success && result.gameState?.success) {
          dispatch({
            type: "update_shogi_game",
            payload: result.gameState.shogiGame!,
          });
          dispatch({
            type: "create_branch",
            payload: {
              newJkf: result.newJKF!,
              newBranchPath: result.newBranchPath!,
              move: result.move!,
              parentMoveIndex: state.currentMoveIndex,
            },
          });

          dispatch({ type: "clear_selection" });

          // ファイル保存
          if (selectedNode && !selectedNode.isDir) {
            try {
              await MoveService.saveToFile(result.newJKF!, selectedNode.path);
            } catch (saveError) {
              console.warn("ファイル保存に失敗しました:", saveError);
            }
          }
        } else {
          throw new Error(result.error || "分岐の作成に失敗しました");
        }
      });
    },
    [
      state.originalJKF,
      state.shogiGame,
      state.selectedPosition,
      state.currentMoveIndex,
      state.currentBranchPath,
      selectedNode,
      withAsyncErrorHandling,
    ],
  );

  // 分岐削除の実装
  const deleteBranch = useCallback(() => {
    // TODO: 分岐削除機能実装
    console.warn("deleteBranch 未実装");
    throw new Error("分岐削除機能は未実装です");
  }, []);

  // モード切り替え
  const setMode = useCallback((mode: "replay" | "analysis") => {
    dispatch({ type: "set_mode", payload: mode });
  }, []);

  // エラークリア
  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  // 便利な状態取得関数
  const isGameLoaded = useCallback(() => {
    return state.originalJKF !== null && state.shogiGame !== null;
  }, [state.originalJKF, state.shogiGame]);

  const getCurrentTurn = useCallback(() => {
    return state.shogiGame?.turn || Color.Black;
  }, [state.shogiGame]);

  const hasNextMove = useCallback(() => {
    if (!state.originalJKF || !state.originalJKF.moves) return false;

    const moves = state.originalJKF.moves;
    const nextIndex = state.currentMoveIndex + 1;

    // 配列の範囲内かチェック
    if (nextIndex >= moves.length) return false;

    // 次の要素が実際の手かチェック
    const nextElement = moves[nextIndex];
    return (
      nextElement &&
      typeof nextElement === "object" &&
      "move" in nextElement &&
      nextElement.move
    );
  }, [state.originalJKF, state.currentMoveIndex]);

  const hasPreviousMove = useCallback(() => {
    if (!state.originalJKF) return false;

    return state.currentMoveIndex > 0;
  }, [state.originalJKF, state.currentMoveIndex]);

  const getLegalMoves = useCallback(() => {
    return state.legalMoves;
  }, [state.legalMoves]);

  const isInCheck = useCallback(
    (color?: Color) => {
      if (!state.shogiGame) return false;
      const targetColor = color || state.shogiGame.turn;
      return state.shogiGame.isCheck(targetColor);
    },
    [state.shogiGame],
  );

  const canMakeMove = useCallback(
    (move: IMove) => {
      if (!state.shogiGame) return false;
      const validation = GameStateManager.validateMove(state.shogiGame, move);
      return validation.success && validation.isLegal;
    },
    [state.shogiGame],
  );

  // Operations オブジェクト
  const operations: GameOperations = {
    // 基本操作
    loadGame,

    // JKFナビゲーション
    goToJKFIndex,
    goToJKFIndexWithBranch,
    nextElement,
    previousElement,
    goToStart,
    goToEnd,

    // 手の操作
    nextMove,
    previousMove,

    // 選択操作
    selectSquare,
    selectHand,
    clearSelection,

    // 手の実行
    makeMove,

    // コメント・特殊情報
    addComment,
    addSpecial,

    // 分岐操作
    switchToBranch,
    createBranch,
    deleteBranch,

    // モード切り替え
    setMode,

    // エラー処理
    clearError,
  };

  return (
    <GameContext.Provider
      value={{
        state,
        operations,
        isGameLoaded,
        hasNextMove,
        getCurrentTurn,
        hasPreviousMove,
        getLegalMoves,
        isInCheck,
        canMakeMove,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

// Hook
export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
}
