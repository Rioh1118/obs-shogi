import { useCallback, useMemo, useReducer } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color, type Kind } from "shogi.js";

import { gameReducer } from "./reducer";
import {
  initialGameState,
  type GameContextType,
  type GameProviderProps,
  type GameView,
  type JKFPlayerHelpers,
  type ShogiMove,
  type StandardMoveFormat,
} from "./types";
import { GameContext } from "./context";

import type { JKFData } from "@/entities/kifu";
import {
  ROOT_CURSOR,
  normalizeForkPointers,
  type ForkPointer,
  type KifuCursor,
} from "@/entities/kifu/model/cursor";
import { ShogiMoveValidator } from "../lib/shogiMoveValidator";
import { computeLeafTesuu } from "@/entities/kifu/lib/leafTesuu";
import { applyMoveWithBranch } from "@/entities/kifu/lib/applyMoveWithBranch";
import type { DeleteQuery, SwapQuery } from "@/entities/kifu/model/branch";
import {
  deleteBranchInKifu,
  swapBranchesInKifu,
} from "@/entities/kifu/lib/branchEdit";
import { fromIMove, toIMoveMoveFormat } from "../lib/moveConverter";
import { buildPlayer, cloneJkf } from "../lib/jkf";
import {
  cursorFromPlayer,
  lastMovePlayer,
  mergeBranchPlan,
  sameForkPointers,
} from "../lib/cursor";

export function GameProvider({ children, persistence }: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const moveValidator = useMemo(() => new ShogiMoveValidator(), []);

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

  const view = useMemo<GameView>(() => {
    if (!state.jkf) {
      return {
        player: null,
        legalMoves: [],
        lastMove: null,
        currentMove: undefined,
        currentComments: [],
        currentTurn: Color.Black,
        totalMoves: 0,
      };
    }

    try {
      const player = buildPlayer(state.jkf, state.cursor);

      const plannedCursor = state.cursor
        ? {
            ...state.cursor,
            forkPointers: state.branchPlan,
          }
        : null;

      let totalMoves = 0;
      try {
        totalMoves = computeLeafTesuu(player, plannedCursor);
      } catch {
        totalMoves = player.getMaxTesuu();
      }

      let currentMove: IMoveMoveFormat | undefined;
      try {
        currentMove = player.tesuu === 0 ? undefined : player.getMove();
      } catch {
        currentMove = undefined;
      }

      let currentComments: string[] = [];
      try {
        const comments = player.getComments();
        currentComments = Array.isArray(comments) ? comments : [];
      } catch {
        currentComments = [];
      }

      let currentTurn = Color.Black;
      try {
        currentTurn = player.shogi.turn;
      } catch {
        currentTurn = Color.Black;
      }

      let legalMoves: ShogiMove[] = [];
      try {
        const sel = state.selectedPosition;
        if (sel) {
          if (sel.type === "square") {
            legalMoves = moveValidator.getLegalMovesFrom(
              player.shogi,
              sel.x,
              sel.y,
            );
          } else {
            legalMoves = moveValidator.getLegalDropsByKind(
              player.shogi,
              sel.color,
              sel.kind,
            );
          }
        }
      } catch {
        legalMoves = [];
      }

      return {
        player,
        legalMoves,
        lastMove: lastMovePlayer(player),
        currentMove,
        currentComments,
        currentTurn,
        totalMoves,
      };
    } catch {
      return {
        player: null,
        legalMoves: [],
        lastMove: null,
        currentMove: undefined,
        currentComments: [],
        currentTurn: Color.Black,
        totalMoves: 0,
      };
    }
  }, [
    state.jkf,
    state.cursor,
    state.branchPlan,
    state.selectedPosition,
    moveValidator,
  ]);

  const navigate = useCallback(
    (
      run: (player: JKFPlayer, branchPlan: ForkPointer[]) => boolean | void,
      errorMessage: string,
    ) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "clear_error" });

        const player = buildPlayer(state.jkf, state.cursor);
        const beforePointer =
          state.cursor?.tesuuPointer ?? (player.getTesuuPointer() as string);

        const result = run(player, state.branchPlan);
        if (result === false) return;

        const nextCursor = cursorFromPlayer(player);
        const nextBranchPlan = mergeBranchPlan(nextCursor, state.branchPlan);

        if (
          nextCursor.tesuuPointer === beforePointer &&
          sameForkPointers(nextBranchPlan, state.branchPlan)
        ) {
          return;
        }

        dispatch({
          type: "navigated",
          payload: {
            cursor: nextCursor,
            branchPlan: nextBranchPlan,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : errorMessage;
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [state.jkf, state.cursor, state.branchPlan],
  );

  const edit = useCallback(
    async (
      run: (player: JKFPlayer, nextJkf: JKFData) => boolean | void,
      errorMessage: string,
      opt?: { forceCommit?: boolean },
    ) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        const nextJkf = cloneJkf(state.jkf);
        const player = buildPlayer(nextJkf, state.cursor);
        const beforePointer =
          state.cursor?.tesuuPointer ?? (player.getTesuuPointer() as string);

        const result = run(player, nextJkf);
        if (result === false) return;

        const nextCursor = cursorFromPlayer(player);
        if (!opt?.forceCommit && nextCursor.tesuuPointer === beforePointer) {
          return;
        }

        dispatch({
          type: "jkf_replaced",
          payload: {
            jkf: nextJkf,
            cursor: nextCursor,
            branchPlan: [...nextCursor.forkPointers],
          },
        });

        await persistIfPossible(nextJkf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : errorMessage;
        dispatch({ type: "set_error", payload: msg });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [state.jkf, state.cursor, persistIfPossible],
  );

  const loadGame = useCallback(async (jkf: JKFData, absPath: string | null) => {
    try {
      dispatch({ type: "clear_error" });
      dispatch({ type: "set_loading", payload: true });

      const nextJkf = cloneJkf(jkf);
      const player = new JKFPlayer(nextJkf);
      const cursor = cursorFromPlayer(player);

      dispatch({
        type: "game_loaded",
        payload: { jkf: nextJkf, absPath, cursor },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load game";
      dispatch({ type: "set_error", payload: msg });
    } finally {
      dispatch({ type: "set_loading", payload: false });
    }
  }, []);

  const resetGame = useCallback(() => {
    dispatch({ type: "reset_state" });
  }, []);

  const goToIndex = useCallback(
    (index: number) => {
      navigate((player, branchPlan) => {
        player.goto(index, normalizeForkPointers(branchPlan, index));
      }, "Failed to go to index");
    },
    [navigate],
  );

  const nextMove = useCallback(() => {
    navigate((player, branchPlan) => {
      const nextTe = player.tesuu + 1;
      const planned = branchPlan.find((p) => p.te === nextTe);

      if (planned && player.forkAndForward(planned.forkIndex)) {
        return true;
      }

      return player.forward();
    }, "Failed to move forward");
  }, [navigate]);

  const previousMove = useCallback(() => {
    navigate((player) => {
      if (player.tesuu <= 0) return false;
      return player.backward();
    }, "Failed to move backward");
  }, [navigate]);

  const goToStart = useCallback(() => {
    navigate((player) => {
      player.goto(0);
    }, "Failed to go to start");
  }, [navigate]);

  const goToEnd = useCallback(() => {
    navigate((player, branchPlan) => {
      const plannedMap = new Map<number, number>();
      for (const p of branchPlan) {
        plannedMap.set(p.te, p.forkIndex);
      }

      const startTesuu = player.tesuu;
      let limit = 10000;

      while (limit-- > 0) {
        const nextTe = player.tesuu + 1;

        const forkIndex = plannedMap.get(nextTe);
        if (forkIndex !== undefined && player.forkAndForward(forkIndex)) {
          continue;
        }

        const ok = player.forward();
        if (!ok) break;
      }

      if (limit <= 0) throw new Error("goToEnd overflows");
      if (player.tesuu === startTesuu) return false;
    }, "Failed to go to end");
  }, [navigate]);

  const makeMove = useCallback(
    async (move: StandardMoveFormat) => {
      await edit((player) => {
        applyMoveWithBranch(player, toIMoveMoveFormat(move));
      }, "Failed to make move");
    },
    [edit],
  );

  const swapBranches = useCallback(
    async (q: SwapQuery) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        const nextJkf = cloneJkf(state.jkf);
        const res = swapBranchesInKifu(nextJkf, q, state.cursor);

        if (!res.changed) return;

        const baseCursor = res.nextCursor ?? state.cursor ?? ROOT_CURSOR;
        const rebuilt = buildPlayer(nextJkf, baseCursor);
        const nextCursor = cursorFromPlayer(rebuilt);

        dispatch({
          type: "jkf_replaced",
          payload: {
            jkf: nextJkf,
            cursor: nextCursor,
            branchPlan: [...nextCursor.forkPointers],
          },
        });

        await persistIfPossible(nextJkf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to swap branches";
        dispatch({ type: "set_error", payload: msg });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [state.jkf, state.cursor, persistIfPossible],
  );

  const deleteBranch = useCallback(
    async (q: DeleteQuery) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        const nextJkf = cloneJkf(state.jkf);
        const res = deleteBranchInKifu(nextJkf, q, state.cursor);

        if (!res.changed) return;

        const baseCursor = res.nextCursor ?? state.cursor ?? ROOT_CURSOR;
        const rebuilt = buildPlayer(nextJkf, baseCursor);
        const nextCursor = cursorFromPlayer(rebuilt);

        dispatch({
          type: "jkf_replaced",
          payload: {
            jkf: nextJkf,
            cursor: nextCursor,
            branchPlan: [...nextCursor.forkPointers],
          },
        });

        await persistIfPossible(nextJkf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to delete branch";
        dispatch({ type: "set_error", payload: msg });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [state.jkf, state.cursor, persistIfPossible],
  );

  const selectSquare = useCallback(
    async (x: number, y: number, promote?: boolean) => {
      const player = view.player;
      if (!player) return;

      try {
        const shogi = player.shogi;
        const piece = shogi.get(x, y);
        const currentTurn = shogi.turn;

        if (state.selectedPosition?.type === "hand") {
          const dropMove = view.legalMoves.find(
            (m) => m.to.x === x && m.to.y === y,
          );

          if (dropMove) {
            const standardMove = fromIMove(
              dropMove,
              state.selectedPosition.kind,
              state.selectedPosition.color,
            );
            await makeMove(standardMove);
          } else {
            dispatch({ type: "clear_selection" });
          }
          return;
        }

        if (state.selectedPosition?.type === "square") {
          if (
            state.selectedPosition.x === x &&
            state.selectedPosition.y === y
          ) {
            dispatch({ type: "clear_selection" });
            return;
          }

          const move = view.legalMoves.find(
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
            return;
          }

          if (piece && piece.color === currentTurn) {
            dispatch({
              type: "set_selection",
              payload: { type: "square", x, y },
            });
          } else {
            dispatch({ type: "clear_selection" });
          }
          return;
        }

        if (piece && piece.color === currentTurn) {
          dispatch({
            type: "set_selection",
            payload: { type: "square", x, y },
          });
        } else {
          dispatch({ type: "clear_selection" });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to select square";
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [view.player, view.legalMoves, state.selectedPosition, makeMove],
  );

  const selectHand = useCallback(
    (color: Color, kind: Kind) => {
      const player = view.player;
      if (!player) return;

      try {
        const currentTurn = player.shogi.turn;
        if (color !== currentTurn) {
          dispatch({ type: "clear_selection" });
          return;
        }

        const legalMoves = moveValidator.getLegalDropsByKind(
          player.shogi,
          color,
          kind,
        );

        if (legalMoves.length === 0) {
          dispatch({ type: "clear_selection" });
          return;
        }

        dispatch({
          type: "set_selection",
          payload: { type: "hand", color, kind },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to select hand";
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [view.player, moveValidator],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "clear_selection" });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const isGameLoaded = useCallback(() => state.jkf !== null, [state.jkf]);

  const isAtStart = useCallback(() => {
    return (state.cursor?.tesuu ?? 0) === 0;
  }, [state.cursor]);

  const isAtEnd = useCallback(() => {
    return (state.cursor?.tesuu ?? 0) >= view.totalMoves;
  }, [state.cursor, view.totalMoves]);

  const canGoForward = useCallback(() => {
    return (state.cursor?.tesuu ?? 0) < view.totalMoves;
  }, [state.cursor, view.totalMoves]);

  const canGoBackward = useCallback(() => {
    return (state.cursor?.tesuu ?? 0) > 0;
  }, [state.cursor]);

  const getCurrentTurn = useCallback(
    () => view.currentTurn,
    [view.currentTurn],
  );

  const getCurrentMoveIndex = useCallback(() => {
    return state.cursor?.tesuu ?? 0;
  }, [state.cursor]);

  const getTotalMoves = useCallback(() => view.totalMoves, [view.totalMoves]);

  const hasSelection = useCallback(() => {
    return state.selectedPosition !== null;
  }, [state.selectedPosition]);

  const getCurrentMove = useCallback(() => {
    return view.currentMove;
  }, [view.currentMove]);

  const getCurrentComments = useCallback(() => {
    return view.currentComments;
  }, [view.currentComments]);

  const applyCursor = useCallback(
    (cursor: KifuCursor) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "clear_error" });

        const nextPlayer = buildPlayer(state.jkf, cursor);
        const nextCursor = cursorFromPlayer(nextPlayer);
        const nextBranchPlan = mergeBranchPlan(
          nextCursor,
          state.branchPlan,
          cursor.forkPointers,
        );

        dispatch({
          type: "navigated",
          payload: {
            cursor: nextCursor,
            branchPlan: nextBranchPlan,
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to apply cursor";
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [state.jkf, state.branchPlan],
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
    view,
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
