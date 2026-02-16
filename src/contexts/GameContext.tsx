import {
  useContext,
  useEffect,
  createContext,
  type ReactNode,
  useReducer,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { JKFPlayer } from "json-kifu-format";
import type {
  GameContextState,
  GameAction,
  JKFPlayerHelpers,
  StandardMoveFormat,
  GameContextType,
  ForkPointer,
  TesuuPointer,
  MutateResult,
  MutateOptions,
} from "@/types";
import type { GameMode, JKFData, Kind, ShogiMove } from "@/types";
import { initialGameState, ROOT_CURSOR } from "@/types";
import { Color } from "shogi.js";
import type { KifuWriter } from "@/interfaces";
import { ShogiMoveValidator } from "@/services/game/ShogiMoveValidator";
import { fromIMove, toIMoveMoveFormat } from "@/adapter/moveConverter";
import { useFileTree } from "./FileTreeContext";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { applyMoveWithBranch } from "@/services/game/applyMoveWithBranchAware";
import { type KifuCursor } from "@/types";
import {
  appliedForkPointers,
  applyCursorToPlayer,
  mergeForkPointers,
} from "@/utils/kifuCursor";
import { computeLeafTesuu } from "@/utils/jkfNavigation";
import { deleteBranchInKifu, swapBranchesInKifu } from "@/utils/branch";
import type { DeleteQuery, SwapQuery } from "@/types/branch";

function lastMovePlayer(jkf: JKFPlayer): ShogiMove | null {
  if (jkf.tesuu === 0) return null;

  const mv = jkf.getMove();
  if (!mv || !mv.to) return null;

  return {
    from: mv.from,
    to: mv.to,
    kind: mv.piece,
    color: mv.color,
  };
}

/**
 * JKFPlayerの変更後に必ず呼ぶ「同期処理」。
 * - cursor/lastMove 更新
 * - selection クリア
 * - 再描画トリガ（set_jkf_player or update）
 */

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

    case "set_cursor":
      return {
        ...state,
        cursor: action.payload,
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
  const cursorRef = useRef<KifuCursor | null>(null);
  const {
    selectedNode,
    jkfData: fileTreeJkfData,
    kifuFormat: fileTreeKifuFormat,
    isKifuSelected,
  } = useFileTree();

  const leafTesuu = useMemo(() => {
    if (!state.jkfPlayer) return 0;
    try {
      return computeLeafTesuu(state.jkfPlayer, state.cursor);
    } catch {
      // フェイルセーフ（ここに落ちるのは基本レア）
      return state.jkfPlayer.getMaxTesuu();
    }
  }, [state.jkfPlayer, state.cursor]);

  const saveKifuIfPossible = useCallback(
    async (jkfToSave: JKFData) => {
      if (
        !kifuWriter ||
        !selectedNode ||
        selectedNode.isDirectory ||
        !fileTreeKifuFormat
      ) {
        return;
      }

      try {
        await kifuWriter.writeToFile(
          jkfToSave,
          selectedNode.path,
          fileTreeKifuFormat,
        );
      } catch (e) {
        console.warn("Failed to save kifu file:", e);
      }
    },
    [kifuWriter, selectedNode, fileTreeKifuFormat],
  );

  const commitFromPlayer = useCallback(
    (jkf: JKFPlayer, prevCursor: KifuCursor | null) => {
      const tesuu = jkf.tesuu;
      const applied = (jkf.getForkPointers?.(tesuu) ?? []) as ForkPointer[];

      const forkPointers = mergeForkPointers(
        applied,
        prevCursor?.forkPointers,
        tesuu,
      );

      const cursor: KifuCursor = {
        tesuu,
        forkPointers,
        tesuuPointer: jkf.getTesuuPointer(tesuu) as TesuuPointer,
      };

      cursorRef.current = cursor;

      const lastMove = lastMovePlayer(jkf);

      dispatch({
        type: "partial_update",
        payload: {
          cursor,
          lastMove,
          selectedPosition: null,
          legalMoves: [],
          jkfPlayer: jkf,
        },
      });
    },
    [dispatch],
  );

  const mutatePlayer = useCallback(
    (
      fn: (
        jkf: JKFPlayer,
        prevCursor: KifuCursor | null,
      ) => MutateResult | void,
      errorMessage: string,
      opt?: MutateOptions,
    ) => {
      const jkf = state.jkfPlayer;
      if (!jkf) return;
      const prevCursor = cursorRef.current;

      try {
        dispatch({ type: "clear_error" });

        applyCursorToPlayer(jkf, prevCursor);

        const beforePtr = jkf.getTesuuPointer();
        const result = fn(jkf, prevCursor);

        if (result === false) return;

        const cursorForCommit =
          typeof result === "object" && result && "cursorForCommit" in result
            ? (result.cursorForCommit ?? prevCursor)
            : prevCursor;

        const playerForCommit =
          typeof result === "object" && result && "playerForCommit" in result
            ? (result.playerForCommit ?? jkf)
            : jkf;

        const afterPtr = playerForCommit.getTesuuPointer();
        if (
          !opt?.forceCommit &&
          playerForCommit === jkf &&
          beforePtr === afterPtr
        ) {
          return;
        }
        commitFromPlayer(playerForCommit, cursorForCommit);
      } catch (e) {
        dispatch({
          type: "set_error",
          payload: e instanceof Error ? e.message : errorMessage,
        });
      }
    },
    [state.jkfPlayer, commitFromPlayer],
  );

  // 1. loadGame - JKFデータから棋譜を読み込む
  const loadGame = useCallback(
    async (jkf: JKFData, absPath: string | null) => {
      try {
        dispatch({ type: "clear_error" });
        dispatch({
          type: "partial_update",
          payload: {
            jkfPlayer: null,
            cursor: null,
            lastMove: null,
            selectedPosition: null,
            legalMoves: [],
            loadedAbsPath: absPath,
          },
        });
        dispatch({ type: "set_loading", payload: true });

        cursorRef.current = null;

        const jkfPlayer = new JKFPlayer(jkf);

        // 同期
        commitFromPlayer(jkfPlayer, null);
      } catch (error) {
        dispatch({
          type: "set_error",
          payload:
            error instanceof Error ? error.message : "Failed to load game",
        });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [commitFromPlayer],
  );

  useEffect(() => {
    cursorRef.current = state.cursor ?? null;
  }, [state.cursor]);

  useEffect(() => {
    const syncWithFileTree = async () => {
      // 棋譜が選択されていて、JKFデータがある場合
      if (isKifuSelected() && fileTreeJkfData) {
        try {
          const absPath =
            selectedNode && !selectedNode.isDirectory
              ? selectedNode.path
              : null;
          await loadGame(fileTreeJkfData, absPath);
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
        cursorRef.current = null;
        // 棋譜が選択されていない場合はリセット
        dispatch({
          type: "partial_update",
          payload: {
            jkfPlayer: null,
            cursor: null,
            lastMove: null,
            selectedPosition: null,
            legalMoves: [],
            loadedAbsPath: null,
          },
        });
      }
    };

    syncWithFileTree();
  }, [fileTreeJkfData, isKifuSelected, selectedNode, loadGame]); // fileTreeJkfDataの変更を監視
  // goToIndex - 指定した手数に移動
  const goToIndex = useCallback(
    (index: number) => {
      mutatePlayer((jkf) => {
        const cursor = cursorRef.current;
        if (!cursor) {
          jkf.goto(index);
          return;
        }
        jkf.goto(index, appliedForkPointers(cursor, index));
      }, "Failed to go to index");
    },
    [mutatePlayer],
  );

  // nextMove - 次の手に進む
  const nextMove = useCallback(() => {
    mutatePlayer((jkf) => {
      const cursor = cursorRef.current;
      const nextTe = jkf.tesuu + 1;

      const planned = cursor?.forkPointers?.find((p) => p.te === nextTe);
      if (planned) {
        const ok = jkf.forkAndForward(planned.forkIndex);
        if (ok) return true;
      }
      return jkf.forward();
    }, "Failed to move forward");
  }, [mutatePlayer]);

  // previousMove - 前の手に戻る
  const previousMove = useCallback(() => {
    mutatePlayer((jkf) => {
      if (jkf.tesuu <= 0) return false;
      return jkf.backward();
    }, "Failed to move backward");
  }, [mutatePlayer]);

  //  goToStart - 初期局面に移動
  const goToStart = useCallback(() => {
    mutatePlayer((jkf) => {
      jkf.goto(0);
    }, "Failed to go to start");
  }, [mutatePlayer]);

  // goToEnd - 最終局面に移動
  const goToEnd = useCallback(() => {
    mutatePlayer((jkf) => {
      const cursor = cursorRef.current;
      const plannedMap = new Map<number, number>();
      for (const p of cursor?.forkPointers ?? []) {
        plannedMap.set(p.te, p.forkIndex);
      }

      const startTesuu = jkf.tesuu;
      let limit = 10000;

      while (limit-- > 0) {
        const nextTe = jkf.tesuu + 1;

        const forkIndex = plannedMap.get(nextTe);
        if (forkIndex !== undefined) {
          const ok = jkf.forkAndForward(forkIndex);
          if (ok) continue;
        }

        const ok = jkf.forward();
        if (!ok) break;
      }

      if (limit <= 0) throw new Error("goToEnd overflows");
      if (jkf.tesuu === startTesuu) return false;
    }, "Failed to go to end");
  }, [mutatePlayer]);

  const moveValidator = useMemo(() => new ShogiMoveValidator(), []);

  const makeMove = useCallback(
    async (move: StandardMoveFormat) => {
      if (!state.jkfPlayer) return;

      const prevCursor = cursorRef.current;

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        applyCursorToPlayer(state.jkfPlayer, prevCursor);
        const jkfMove = toIMoveMoveFormat(move);

        // 分岐aware適用
        applyMoveWithBranch(state.jkfPlayer, jkfMove);

        // 同期
        commitFromPlayer(state.jkfPlayer, prevCursor);

        if (
          kifuWriter &&
          selectedNode &&
          !selectedNode.isDirectory &&
          fileTreeKifuFormat
        ) {
          try {
            await kifuWriter.writeToFile(
              state.jkfPlayer.kifu,
              selectedNode.path,
              fileTreeKifuFormat,
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
    [
      state.jkfPlayer,
      commitFromPlayer,
      kifuWriter,
      selectedNode,
      fileTreeKifuFormat,
    ],
  );

  const swapBranches = useCallback(
    async (q: SwapQuery) => {
      let kifuToSave: JKFData | null = null;
      let didChange = false;
      mutatePlayer(
        (jkf, prevCursor) => {
          const res = swapBranchesInKifu(jkf.kifu as JKFData, q, prevCursor);
          if (!res.changed) return false;

          const next = res.nextCursor ?? prevCursor ?? ROOT_CURSOR;

          const rebuilt = new JKFPlayer(jkf.kifu as JKFData);
          rebuilt.goto(next.tesuu, appliedForkPointers(next, next.tesuu));

          didChange = true;
          kifuToSave = jkf.kifu as JKFData;

          return { cursorForCommit: next, playerForCommit: rebuilt };
        },
        "Failed to swap branches",
        { forceCommit: true },
      );
      if (didChange && kifuToSave) {
        await saveKifuIfPossible(kifuToSave);
      }
    },
    [mutatePlayer, saveKifuIfPossible],
  );

  const deleteBranch = useCallback(
    async (q: DeleteQuery) => {
      let kifuToSave: JKFData | null = null;
      let didChange = false;

      mutatePlayer(
        (jkf, prevCursor) => {
          const res = deleteBranchInKifu(jkf.kifu as JKFData, q, prevCursor);
          if (!res.changed) return false;

          const next = res.nextCursor ?? prevCursor ?? ROOT_CURSOR;
          const rebuilt = new JKFPlayer(jkf.kifu as JKFData);
          rebuilt.goto(next.tesuu, appliedForkPointers(next, next.tesuu));

          didChange = true;
          kifuToSave = jkf.kifu as JKFData;

          return { cursorForCommit: next, playerForCommit: rebuilt };
        },
        "Failed to delete branch",
        { forceCommit: true },
      );
      if (didChange && kifuToSave) {
        await saveKifuIfPossible(kifuToSave);
      }
    },
    [mutatePlayer, saveKifuIfPossible],
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
    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu === 0;
  }, [state.jkfPlayer, state.cursor?.tesuu]);

  // 14. isAtEnd - 最終局面にいるかどうか
  const isAtEnd = useCallback((): boolean => {
    if (!state.jkfPlayer) return true;

    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu >= leafTesuu;
  }, [state.jkfPlayer, state.cursor?.tesuu, leafTesuu]);

  // 15. canGoForward - 次に進めるかどうか
  const canGoForward = useCallback((): boolean => {
    if (!state.jkfPlayer) return false;
    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu < leafTesuu;
  }, [state.jkfPlayer, state.cursor?.tesuu, leafTesuu]);

  // 16. canGoBackward - 前に戻れるかどうか
  const canGoBackward = useCallback((): boolean => {
    if (!state.jkfPlayer) return false;

    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu > 0;
  }, [state.jkfPlayer, state.cursor?.tesuu]);

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

    return leafTesuu;
  }, [state.jkfPlayer, leafTesuu]);
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

  /**
   * 渡されたカーソルを採用
   * */
  const applyCursor = useCallback(
    (cursor: KifuCursor) => {
      const jkf = state.jkfPlayer;
      if (!jkf) return;
      try {
        dispatch({ type: "clear_error" });

        jkf.goto(cursor.tesuu, appliedForkPointers(cursor, cursor.tesuu));

        commitFromPlayer(jkf, cursor);
      } catch (e) {
        dispatch({
          type: "set_error",
          payload: e instanceof Error ? e.message : "Failed to apply cursor",
        });
      }
    },
    [state.jkfPlayer, commitFromPlayer],
  );

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
    swapBranches,
    deleteBranch,
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
    applyCursor,
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
