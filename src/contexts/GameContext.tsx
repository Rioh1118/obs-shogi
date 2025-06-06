import {
  useContext,
  useEffect,
  createContext,
  type ReactNode,
  useReducer,
  useMemo,
  useCallback,
} from "react";
import { JKFPlayer } from "json-kifu-format";
import type {
  GameContextState,
  GameAction,
  JKFPlayerHelpers,
  StandardMoveFormat,
  GameContextType,
} from "@/types";
import type { GameMode, JKFData, Kind, ShogiMove } from "@/types";
import { initialGameState } from "@/types";
import { Color } from "shogi.js";
import type { KifuWriter } from "@/interfaces";
import { ShogiMoveValidator } from "@/services/game/ShogiMoveValidator";
import { fromIMove, toIMoveMoveFormat } from "@/adapter/moveConverter";
import { useFileTree } from "./FileTreeContext";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";

function gameReducer(
  state: GameContextState,
  action: GameAction,
): GameContextState {
  switch (action.type) {
    // JKFPlayer管理
    case "set_jkf_player":
      return {
        ...state,
        jkfPlayer: action.payload,
        error: null,
      };

    case "update_jkf_player":
      return {
        ...state,
      };

    // 選択状態
    case "set_selection":
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

    // 手の記録
    case "set_last_move":
      return {
        ...state,
        lastMove: action.payload,
      };

    // モード
    case "set_mode":
      return {
        ...state,
        mode: action.payload,
      };

    // ローディング・エラー
    case "set_loading":
      return {
        ...state,
        isLoading: action.payload,
      };

    case "set_error":
      return {
        ...state,
        error: action.payload,
        isLoading: false, // エラー時はローディングを終了
      };

    case "clear_error":
      return {
        ...state,
        error: null,
      };

    // 初期化・リセット
    case "reset_state":
      return {
        ...initialGameState,
      };

    // 部分更新
    case "partial_update":
      return {
        ...state,
        ...action.payload,
      };

    default:
      return state;
  }
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({
  children,
  kifuWriter,
}: {
  children: ReactNode;
  kifuWriter: KifuWriter;
}) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const {
    selectedNode,
    jkfData: fileTreeJkfData,
    kifuFormat: fileTreeKifuFormat,
    isKifuSelected,
  } = useFileTree();

  // 1. loadGame - JKFデータから棋譜を読み込む
  const loadGame = useCallback(async (jkf: JKFData) => {
    try {
      dispatch({ type: "clear_error" });
      dispatch({ type: "set_loading", payload: true });

      const jkfPlayer = new JKFPlayer(jkf);
      dispatch({ type: "set_jkf_player", payload: jkfPlayer });

      // 初期状態の設定
      dispatch({ type: "clear_selection" });
      dispatch({ type: "set_last_move", payload: null });
    } catch (error) {
      dispatch({
        type: "set_error",
        payload: error instanceof Error ? error.message : "Failed to load game",
      });
    } finally {
      dispatch({ type: "set_loading", payload: false });
    }
  }, []);

  useEffect(() => {
    const syncWithFileTree = async () => {
      // 棋譜が選択されていて、JKFデータがある場合
      if (isKifuSelected() && fileTreeJkfData) {
        try {
          await loadGame(fileTreeJkfData);
        } catch (error) {
          dispatch({
            type: "set_error",
            payload:
              error instanceof Error
                ? error.message
                : "Failed to sync with file tree",
          });
        }
      } else {
        // 棋譜が選択されていない場合はリセット
        dispatch({ type: "set_jkf_player", payload: null });
        dispatch({ type: "clear_selection" });
      }
    };

    syncWithFileTree();
  }, [fileTreeJkfData, isKifuSelected, loadGame]); // fileTreeJkfDataの変更を監視
  // 2. goToIndex - 指定した手数に移動
  const goToIndex = useCallback(
    (index: number) => {
      if (!state.jkfPlayer) return;

      try {
        // index: 0=初期局面, 1=1手目2=2手目...
        state.jkfPlayer.goto(index);
        dispatch({ type: "update_jkf_player" });
        dispatch({ type: "clear_selection" });

        if (index > 0) {
          // lastMoveの更新（現在の手を取得）
          const currentMove = state.jkfPlayer.getMove();
          if (currentMove) {
            const lastMove: ShogiMove = {
              from: currentMove.from,
              to: currentMove.to!,
              kind: currentMove.piece,
              color: currentMove.color,
            };
            dispatch({ type: "set_last_move", payload: lastMove });
          } else {
            dispatch({ type: "set_last_move", payload: null });
          }
        } else {
          dispatch({ type: "set_last_move", payload: null });
        }
      } catch (error) {
        dispatch({
          type: "set_error",
          payload:
            error instanceof Error ? error.message : "Failed to go to index",
        });
      }
    },
    [state.jkfPlayer],
  );

  // 3. nextMove - 次の手に進む
  const nextMove = useCallback(() => {
    if (!state.jkfPlayer) return;

    try {
      const canForward = state.jkfPlayer.tesuu < state.jkfPlayer.getMaxTesuu();
      if (canForward) {
        state.jkfPlayer.forward();
        dispatch({ type: "update_jkf_player" });
        dispatch({ type: "clear_selection" });

        // lastMoveの更新
        const currentMove = state.jkfPlayer.getMove();
        if (currentMove) {
          const lastMove: ShogiMove = {
            from: currentMove.from,
            to: currentMove.to!,
            kind: currentMove.piece,
            color: currentMove.color,
          };
          dispatch({ type: "set_last_move", payload: lastMove });
        }
      }
    } catch (error) {
      dispatch({
        type: "set_error",
        payload:
          error instanceof Error ? error.message : "Failed to move forward",
      });
    }
  }, [state.jkfPlayer]);
  // 4. previousMove - 前の手に戻る
  const previousMove = useCallback(() => {
    if (!state.jkfPlayer) return;

    try {
      const canBackward = state.jkfPlayer.tesuu > 0;
      if (canBackward) {
        state.jkfPlayer.backward();
        dispatch({ type: "update_jkf_player" });
        dispatch({ type: "clear_selection" });

        // 戻った後の手を取得
        if (state.jkfPlayer.tesuu > 0) {
          const currentMove = state.jkfPlayer.getMove();
          if (currentMove) {
            const lastMove: ShogiMove = {
              from: currentMove.from,
              to: currentMove.to!,
              kind: currentMove.piece,
              color: currentMove.color,
            };
            dispatch({ type: "set_last_move", payload: lastMove });
          }
        } else {
          // 初期局面に戻った場合
          dispatch({ type: "set_last_move", payload: null });
        }
      }
    } catch (error) {
      dispatch({
        type: "set_error",
        payload:
          error instanceof Error ? error.message : "Failed to move backward",
      });
    }
  }, [state.jkfPlayer]);

  // 5. goToStart - 初期局面に移動
  const goToStart = useCallback(() => {
    if (!state.jkfPlayer) return;

    try {
      state.jkfPlayer.goto(0); // tesuu = 0 = 初期局面
      dispatch({ type: "update_jkf_player" });
      dispatch({ type: "clear_selection" });
      dispatch({ type: "set_last_move", payload: null }); // 初期局面なので手なし
    } catch (error) {
      dispatch({
        type: "set_error",
        payload:
          error instanceof Error ? error.message : "Failed to go to start",
      });
    }
  }, [state.jkfPlayer]);

  // 6. goToEnd - 最終局面に移動
  const goToEnd = useCallback(() => {
    if (!state.jkfPlayer) return;

    try {
      const maxTesuu = state.jkfPlayer.getMaxTesuu();
      state.jkfPlayer.goto(maxTesuu);
      dispatch({ type: "update_jkf_player" });
      dispatch({ type: "clear_selection" });

      // 最終手を取得
      if (maxTesuu > 0) {
        const currentMove = state.jkfPlayer.getMove();
        if (currentMove) {
          const lastMove: ShogiMove = {
            from: currentMove.from,
            to: currentMove.to!,
            kind: currentMove.piece,
            color: currentMove.color,
          };
          dispatch({ type: "set_last_move", payload: lastMove });
        }
      } else {
        // 手がない場合（空の棋譜）
        dispatch({ type: "set_last_move", payload: null });
      }
    } catch (error) {
      dispatch({
        type: "set_error",
        payload: error instanceof Error ? error.message : "Failed to go to end",
      });
    }
  }, [state.jkfPlayer]);

  const moveValidator = useMemo(() => new ShogiMoveValidator(), []);

  const makeMove = useCallback(
    async (move: StandardMoveFormat) => {
      if (!state.jkfPlayer) return;
      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        // StandardMoveFormat → IMoveMoveFormat に変換
        const jkfMove = toIMoveMoveFormat(move);

        // JKFPlayerで手を追加
        state.jkfPlayer.inputMove(jkfMove);

        // 状態を更新
        dispatch({ type: "update_jkf_player" });
        dispatch({ type: "clear_selection" });

        // lastMoveを更新
        const lastMove: ShogiMove = {
          from: move.from,
          to: move.to,
          kind: move.piece,
        };
        dispatch({ type: "set_last_move", payload: lastMove });

        // kifuWriterで保存（非同期）
        if (
          kifuWriter &&
          selectedNode &&
          !selectedNode.isDirectory &&
          fileTreeKifuFormat
        ) {
          const filePath = selectedNode.path;
          const format = fileTreeKifuFormat;
          try {
            await kifuWriter.writeToFile(
              state.jkfPlayer.kifu,
              filePath,
              format,
            );
          } catch (writeError) {
            console.warn("Failed to save kifu file:", writeError);
          }
        }
      } catch (error) {
        dispatch({
          type: "set_error",
          payload:
            error instanceof Error ? error.message : "Failed to make move",
        });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [fileTreeKifuFormat, selectedNode, state.jkfPlayer, kifuWriter],
  );
  const selectSquare = useCallback(
    async (x: number, y: number, promote?: boolean) => {
      if (!state.jkfPlayer) return;

      try {
        const shogi = state.jkfPlayer.shogi;
        const piece = shogi.get(x, y);
        const currentTurn = shogi.turn;

        // === 持ち駒選択中の場合（駒打ち） ===
        if (state.selectedPosition?.type === "hand") {
          const isLegalDrop = state.legalMoves.some(
            (move) => move.to.x === x && move.to.y === y,
          );

          if (isLegalDrop) {
            const dropMove = state.legalMoves.find(
              (move) => move.to.x === x && move.to.y === y,
            );
            if (dropMove) {
              // StandardMoveFormatに変換してmakeMove
              const standardMove = fromIMove(
                dropMove,
                state.selectedPosition.kind,
                state.selectedPosition.color,
              );
              await makeMove(standardMove);
            }
          }
          dispatch({ type: "clear_selection" });
          return;
        }

        // === 盤上駒選択中の場合（移動） ===
        if (state.selectedPosition?.type === "square") {
          // 同じマスをクリックした場合選択解除
          if (
            state.selectedPosition.x === x &&
            state.selectedPosition.y === y
          ) {
            dispatch({ type: "clear_selection" });
            return;
          }

          const isLegalMove = state.legalMoves.some(
            (move) => move.to.x === x && move.to.y === y,
          );

          if (isLegalMove) {
            const move = state.legalMoves.find(
              (move) => move.to.x === x && move.to.y === y,
            );
            if (move) {
              // 移動元の駒情報を取得
              const fromPiece = shogi.get(
                state.selectedPosition.x,
                state.selectedPosition.y,
              );
              if (fromPiece) {
                const standardMove = fromIMove(
                  move,
                  fromPiece.kind,
                  fromPiece.color,
                  promote,
                );
                await makeMove(standardMove);
              }
            }
            dispatch({ type: "clear_selection" });
            return;
          } else {
            // 合法手でない場合は新しい駒を選択するかクリア
            if (piece && piece.color === currentTurn) {
              const legalMoves = moveValidator.getLegalMovesFrom(shogi, x, y);

              dispatch({
                type: "set_selection",
                payload: {
                  selectedPosition: { type: "square", x, y },
                  legalMoves,
                },
              });
            } else {
              dispatch({ type: "clear_selection" });
            }
            return;
          }
        }

        // === 何も選択していない場合（新規選択） ===
        if (piece && piece.color === currentTurn) {
          const legalMoves = moveValidator.getLegalMovesFrom(shogi, x, y);

          dispatch({
            type: "set_selection",
            payload: {
              selectedPosition: { type: "square", x, y },
              legalMoves,
            },
          });
        } else {
          dispatch({ type: "clear_selection" });
        }
      } catch (error) {
        dispatch({
          type: "set_error",
          payload:
            error instanceof Error ? error.message : "Failed to select square",
        });
      }
    },
    [
      state.jkfPlayer,
      state.selectedPosition,
      state.legalMoves,
      moveValidator,
      makeMove,
    ],
  );

  // 8. selectHand - 持ち駒を選択
  const selectHand = useCallback(
    (color: Color, kind: Kind) => {
      if (!state.jkfPlayer) return;

      try {
        const shogi = state.jkfPlayer.shogi;
        const currentTurn = shogi.turn;

        // 自分の手番でない場合は無視
        if (color !== currentTurn) {
          dispatch({ type: "clear_selection" });
          return;
        }

        const legalMoves = moveValidator.getLegalDropsByKind(
          shogi,
          color,
          kind,
        );

        // 打てる駒がない場合
        if (legalMoves.length === 0) {
          dispatch({ type: "clear_selection" });
          return;
        }

        dispatch({
          type: "set_selection",
          payload: {
            selectedPosition: { type: "hand", color, kind },
            legalMoves,
          },
        });
      } catch (error) {
        dispatch({
          type: "set_error",
          payload:
            error instanceof Error ? error.message : "Failed to select hand",
        });
      }
    },
    [moveValidator, state.jkfPlayer],
  );

  // 9. clearSelection - 選択をクリア
  const clearSelection = useCallback(() => {
    dispatch({ type: "clear_selection" });
  }, []);

  //11. TODO: add comment

  // 12. setMode - モードを変更
  const setMode = useCallback((mode: GameMode) => {
    try {
      dispatch({ type: "set_mode", payload: mode });

      // モード変更時は選択状態をクリア
      dispatch({ type: "clear_selection" });
    } catch (error) {
      dispatch({
        type: "set_error",
        payload: error instanceof Error ? error.message : "Failed to set mode",
      });
    }
  }, []);
  // 13. isAtStart - 初期局面にいるかどうか
  const isAtStart = useCallback((): boolean => {
    if (!state.jkfPlayer) return true;

    try {
      return state.jkfPlayer.tesuu === 0;
    } catch {
      return true;
    }
  }, [state.jkfPlayer]);

  // 14. isAtEnd - 最終局面にいるかどうか
  const isAtEnd = useCallback((): boolean => {
    if (!state.jkfPlayer) return true;

    try {
      return state.jkfPlayer.tesuu >= state.jkfPlayer.getMaxTesuu();
    } catch {
      return true;
    }
  }, [state.jkfPlayer]);

  // 15. canGoForward - 次に進めるかどうか
  const canGoForward = useCallback((): boolean => {
    if (!state.jkfPlayer) return false;

    try {
      return state.jkfPlayer.tesuu < state.jkfPlayer.getMaxTesuu();
    } catch {
      return false;
    }
  }, [state.jkfPlayer]);
  // 16. canGoBackward - 前に戻れるかどうか
  const canGoBackward = useCallback((): boolean => {
    if (!state.jkfPlayer) return false;

    try {
      return state.jkfPlayer.tesuu > 0;
    } catch {
      return false;
    }
  }, [state.jkfPlayer]);

  // 17. getCurrentTurn - 現在の手番を取得
  const getCurrentTurn = useCallback((): Color => {
    if (!state.jkfPlayer) return Color.Black; // デフォルトは先手

    try {
      return state.jkfPlayer.shogi.turn;
    } catch {
      return Color.Black;
    }
  }, [state.jkfPlayer]);

  // 18. getCurrentMoveIndex - 現在の手数を取得
  const getCurrentMoveIndex = useCallback((): number => {
    if (!state.jkfPlayer) return 0;

    try {
      return state.jkfPlayer.tesuu;
    } catch {
      return 0;
    }
  }, [state.jkfPlayer]);
  //
  // 19. clearError - エラーをクリア
  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  // 20. isGameLoaded - ゲームが読み込まれているかどうか
  const isGameLoaded = useCallback((): boolean => {
    try {
      return state.jkfPlayer !== null;
    } catch {
      return false;
    }
  }, [state.jkfPlayer]);

  // 21. getTotalMoves - 総手数を取得
  const getTotalMoves = useCallback((): number => {
    if (!state.jkfPlayer) return 0;

    try {
      return state.jkfPlayer.getMaxTesuu();
    } catch {
      return 0;
    }
  }, [state.jkfPlayer]);
  //
  // 22. hasSelection - 選択状態があるかどうか
  const hasSelection = useCallback((): boolean => {
    try {
      return state.selectedPosition !== null;
    } catch {
      return false;
    }
  }, [state.selectedPosition]);

  // 23. getCurrentMove - 現在の手を取得
  const getCurrentMove = useCallback((): IMoveMoveFormat | undefined => {
    if (!state.jkfPlayer) return undefined;

    try {
      // 現在の手数が0（初期局面）の場合は手がない
      if (state.jkfPlayer.tesuu === 0) return undefined;

      // JKFPlayerから現在の手を取得
      const currentMove = state.jkfPlayer.getMove();
      return currentMove;
    } catch {
      return undefined;
    }
  }, [state.jkfPlayer]);

  // 24. getCurrentComments - 現在の手のコメントを取得
  const getCurrentComments = useCallback((): string[] => {
    if (!state.jkfPlayer) return [];

    try {
      // JKFPlayerから現在局面のコメントを取得
      const comments = state.jkfPlayer.getComments();
      return Array.isArray(comments) ? comments : [];
    } catch {
      return [];
    }
  }, [state.jkfPlayer]);

  // ヘルパー関数を実装
  const helpers: JKFPlayerHelpers = {
    isLegalMove: (jkfPlayer: JKFPlayer, move: ShogiMove): boolean => {
      try {
        return moveValidator.isLegalMove(jkfPlayer.shogi, move);
      } catch {
        return false;
      }
    },
    // 27. canPromoteMove - 成り可能チェック
    canPromoteMove: (jkfPlayer: JKFPlayer, move: ShogiMove): boolean => {
      try {
        return moveValidator.canPromote(jkfPlayer.shogi, move);
      } catch {
        return false;
      }
    },

    // 28. mustPromoteMove - 強制成りチェック
    mustPromoteMove: (jkfPlayer: JKFPlayer, move: ShogiMove): boolean => {
      try {
        return moveValidator.mustPromote(jkfPlayer.shogi, move);
      } catch {
        return false;
      }
    },
  };

  const contextValue: GameContextType = {
    state,
    helpers,
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
    setMode,
    clearError,
    isGameLoaded,
    isAtStart,
    isAtEnd,
    canGoForward,
    canGoBackward,
    getCurrentTurn,
    getCurrentMoveIndex,
    getTotalMoves,
    hasSelection,
    getCurrentMove,
    getCurrentComments,
  };

  return (
    <GameContext.Provider value={contextValue}>{children}</GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGameContext must be used within a GameProvider");
  }
  return context;
}
