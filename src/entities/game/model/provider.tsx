import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color, type Kind } from "shogi.js";

import { gameReducer } from "./reducer";
import {
  initialGameState,
  type GameContextType,
  type GameMode,
  type GameProviderProps,
  type JKFPlayerHelpers,
  type MutateOptions,
  type MutateResult,
  type StandardMoveFormat,
} from "./types";
import { GameContext } from "./context";

import type { JKFData } from "@/entities/kifu";
import type { DeleteQuery, SwapQuery } from "@/types/branch";
import type {
  ForkPointer,
  KifuCursor,
  TesuuPointer,
} from "@/types/kifu-cursor";
import { ROOT_CURSOR } from "@/types/kifu-cursor";

import { ShogiMoveValidator } from "@/services/game/ShogiMoveValidator";
import { fromIMove, toIMoveMoveFormat } from "@/adapter/moveConverter";
import { applyMoveWithBranch } from "@/services/game/applyMoveWithBranchAware";

import {
  appliedForkPointers,
  applyCursorToPlayer,
  mergeForkPointers,
} from "@/utils/kifuCursor";
import { computeLeafTesuu } from "@/utils/jkfNavigation";
import { deleteBranchInKifu, swapBranchesInKifu } from "@/utils/branch";

/** 現局面の一つ前の手を ShogiMove に変換 */
function lastMovePlayer(jkf: JKFPlayer) {
  if (jkf.tesuu === 0) return null;
  const mv = jkf.getMove();
  if (!mv || !mv.to) return null;
  return { from: mv.from, to: mv.to, kind: mv.piece, color: mv.color };
}

export function GameProvider({ children, persistence }: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const cursorRef = useRef<KifuCursor | null>(null);

  const moveValidator = useMemo(() => new ShogiMoveValidator(), []);

  const leafTesuu = useMemo(() => {
    if (!state.jkfPlayer) return 0;
    try {
      return computeLeafTesuu(state.jkfPlayer, state.cursor);
    } catch {
      return state.jkfPlayer.getMaxTesuu();
    }
  }, [state.jkfPlayer, state.cursor]);

  const persistIfPossible = useCallback(
    async (jkfToSave: JKFData) => {
      if (!persistence) return;

      const res = await persistence.save(jkfToSave);
      if (!res.success) {
        dispatch({ type: "set_error", payload: res.error });
      }
    },
    [persistence],
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

      dispatch({
        type: "partial_update",
        payload: {
          cursor,
          lastMove: lastMovePlayer(jkf),
          selectedPosition: null,
          legalMoves: [],
          jkfPlayer: jkf,
        },
      });
    },
    [],
  );

  const mutatePlayer = useCallback(
    (
      fn: (jkf: JKFPlayer, prevCursor: KifuCursor | null) => MutateResult,
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
        const msg = e instanceof Error ? e.message : errorMessage;
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [state.jkfPlayer, commitFromPlayer],
  );

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
        commitFromPlayer(jkfPlayer, null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load game";
        dispatch({ type: "set_error", payload: msg });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [commitFromPlayer],
  );

  const resetGame = useCallback(() => {
    cursorRef.current = null;
    dispatch({
      type: "partial_update",
      payload: {
        jkfPlayer: null,
        cursor: null,
        lastMove: null,
        selectedPosition: null,
        legalMoves: [],
        loadedAbsPath: null,
        isLoading: false,
        error: null,
      },
    });
  }, []);

  useEffect(() => {
    cursorRef.current = state.cursor ?? null;
  }, [state.cursor]);

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

  const previousMove = useCallback(() => {
    mutatePlayer((jkf) => {
      if (jkf.tesuu <= 0) return false;
      return jkf.backward();
    }, "Failed to move backward");
  }, [mutatePlayer]);

  const goToStart = useCallback(() => {
    mutatePlayer((jkf) => {
      jkf.goto(0);
    }, "Failed to go to start");
  }, [mutatePlayer]);

  const goToEnd = useCallback(() => {
    mutatePlayer((jkf) => {
      const cursor = cursorRef.current;
      const plannedMap = new Map<number, number>();
      for (const p of cursor?.forkPointers ?? [])
        plannedMap.set(p.te, p.forkIndex);

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

  const makeMove = useCallback(
    async (move: StandardMoveFormat) => {
      if (!state.jkfPlayer) return;

      const prevCursor = cursorRef.current;

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        applyCursorToPlayer(state.jkfPlayer, prevCursor);
        const jkfMove = toIMoveMoveFormat(move);

        applyMoveWithBranch(state.jkfPlayer, jkfMove);
        commitFromPlayer(state.jkfPlayer, prevCursor);

        await persistIfPossible(state.jkfPlayer.kifu as JKFData);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to make move";
        dispatch({ type: "set_error", payload: msg });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [state.jkfPlayer, commitFromPlayer, persistIfPossible],
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

      if (didChange && kifuToSave) await persistIfPossible(kifuToSave);
    },
    [mutatePlayer, persistIfPossible],
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

      if (didChange && kifuToSave) await persistIfPossible(kifuToSave);
    },
    [mutatePlayer, persistIfPossible],
  );

  const selectSquare = useCallback(
    async (x: number, y: number, promote?: boolean) => {
      if (!state.jkfPlayer) return;

      try {
        const shogi = state.jkfPlayer.shogi;
        const piece = shogi.get(x, y);
        const currentTurn = shogi.turn;

        // === 持ち駒選択中（駒打ち） ===
        if (state.selectedPosition?.type === "hand") {
          const isLegalDrop = state.legalMoves.some(
            (m) => m.to.x === x && m.to.y === y,
          );

          if (isLegalDrop) {
            const dropMove = state.legalMoves.find(
              (m) => m.to.x === x && m.to.y === y,
            );
            if (dropMove) {
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

        // === 盤上駒選択中（移動） ===
        if (state.selectedPosition?.type === "square") {
          if (
            state.selectedPosition.x === x &&
            state.selectedPosition.y === y
          ) {
            dispatch({ type: "clear_selection" });
            return;
          }

          const isLegalMove = state.legalMoves.some(
            (m) => m.to.x === x && m.to.y === y,
          );

          if (isLegalMove) {
            const move = state.legalMoves.find(
              (m) => m.to.x === x && m.to.y === y,
            );
            if (move) {
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
          }

          // 合法手でない → 新しい駒選択 or クリア
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

        // === 何も選択していない（新規選択） ===
        if (piece && piece.color === currentTurn) {
          const legalMoves = moveValidator.getLegalMovesFrom(shogi, x, y);
          dispatch({
            type: "set_selection",
            payload: { selectedPosition: { type: "square", x, y }, legalMoves },
          });
        } else {
          dispatch({ type: "clear_selection" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to select square";
        dispatch({ type: "set_error", payload: msg });
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

  const selectHand = useCallback(
    (color: Color, kind: Kind) => {
      if (!state.jkfPlayer) return;

      try {
        const shogi = state.jkfPlayer.shogi;
        const currentTurn = shogi.turn;

        if (color !== currentTurn) {
          dispatch({ type: "clear_selection" });
          return;
        }

        const legalMoves = moveValidator.getLegalDropsByKind(
          shogi,
          color,
          kind,
        );
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to select hand";
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [moveValidator, state.jkfPlayer],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "clear_selection" });
  }, []);

  const setMode = useCallback((mode: GameMode) => {
    dispatch({ type: "set_mode", payload: mode });
    dispatch({ type: "clear_selection" });
  }, []);

  const isAtStart = useCallback(() => {
    if (!state.jkfPlayer) return true;
    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu === 0;
  }, [state.jkfPlayer, state.cursor?.tesuu]);

  const isAtEnd = useCallback(() => {
    if (!state.jkfPlayer) return true;
    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu >= leafTesuu;
  }, [state.jkfPlayer, state.cursor?.tesuu, leafTesuu]);

  const canGoForward = useCallback(() => {
    if (!state.jkfPlayer) return false;
    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu < leafTesuu;
  }, [state.jkfPlayer, state.cursor?.tesuu, leafTesuu]);

  const canGoBackward = useCallback(() => {
    if (!state.jkfPlayer) return false;
    const tesuu = state.cursor?.tesuu ?? state.jkfPlayer.tesuu;
    return tesuu > 0;
  }, [state.jkfPlayer, state.cursor?.tesuu]);

  const getCurrentTurn = useCallback(() => {
    if (!state.jkfPlayer) return Color.Black;
    try {
      return state.jkfPlayer.shogi.turn;
    } catch {
      return Color.Black;
    }
  }, [state.jkfPlayer]);

  const getCurrentMoveIndex = useCallback(() => {
    if (!state.jkfPlayer) return 0;
    try {
      return state.jkfPlayer.tesuu;
    } catch {
      return 0;
    }
  }, [state.jkfPlayer]);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const isGameLoaded = useCallback(() => {
    return state.jkfPlayer !== null;
  }, [state.jkfPlayer]);

  const getTotalMoves = useCallback(() => {
    if (!state.jkfPlayer) return 0;
    return leafTesuu;
  }, [state.jkfPlayer, leafTesuu]);

  const hasSelection = useCallback(() => {
    return state.selectedPosition !== null;
  }, [state.selectedPosition]);

  const getCurrentMove = useCallback((): IMoveMoveFormat | undefined => {
    if (!state.jkfPlayer) return undefined;
    try {
      if (state.jkfPlayer.tesuu === 0) return undefined;
      return state.jkfPlayer.getMove();
    } catch {
      return undefined;
    }
  }, [state.jkfPlayer]);

  const getCurrentComments = useCallback(() => {
    if (!state.jkfPlayer) return [];
    try {
      const comments = state.jkfPlayer.getComments();
      return Array.isArray(comments) ? comments : [];
    } catch {
      return [];
    }
  }, [state.jkfPlayer]);

  const applyCursor = useCallback(
    (cursor: KifuCursor) => {
      const jkf = state.jkfPlayer;
      if (!jkf) return;

      try {
        dispatch({ type: "clear_error" });
        jkf.goto(cursor.tesuu, appliedForkPointers(cursor, cursor.tesuu));
        commitFromPlayer(jkf, cursor);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to apply cursor";
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [state.jkfPlayer, commitFromPlayer],
  );

  const helpers: JKFPlayerHelpers = {
    isLegalMove: (jkfPlayer, move) => {
      try {
        return moveValidator.isLegalMove(jkfPlayer.shogi, move);
      } catch {
        return false;
      }
    },
    canPromoteMove: (jkfPlayer, move) => {
      try {
        return moveValidator.canPromote(jkfPlayer.shogi, move);
      } catch {
        return false;
      }
    },
    mustPromoteMove: (jkfPlayer, move) => {
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
    resetGame,
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
