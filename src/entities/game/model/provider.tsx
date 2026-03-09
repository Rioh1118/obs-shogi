import { useCallback, useMemo, useReducer } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { IMoveMoveFormat } from "json-kifu-format/dist/src/Formats";
import { Color, type Kind } from "shogi.js";

import { gameReducer } from "./reducer";
import {
  initialGameState,
  type GameContextType,
  type GameDerivedState,
  type GameProviderProps,
  type JKFPlayerHelpers,
  type StandardMoveFormat,
} from "./types";
import { GameContext } from "./context";

import type { JKFData } from "@/entities/kifu";
import {
  ROOT_CURSOR,
  cursorFromSource,
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

/** 現局面の一つ前の手を ShogiMove に変換 */
function lastMovePlayer(jkf: JKFPlayer) {
  if (jkf.tesuu === 0) return null;
  const mv = jkf.getMove();
  if (!mv || !mv.to) return null;
  return { from: mv.from, to: mv.to, kind: mv.piece, color: mv.color };
}

function cloneJKF(jkf: JKFData): JKFData {
  return structuredClone(jkf);
}

function buildPlayer(jkf: JKFData, cursor: KifuCursor | null): JKFPlayer {
  const player = new JKFPlayer(jkf);
  if (cursor) {
    player.goto(cursor.tesuu, cursor.forkPointers);
  }
  return player;
}

function cursorFromPlayer(player: JKFPlayer): KifuCursor {
  return cursorFromSource({
    tesuu: player.tesuu,
    getForkPointers: (tesuu?: number) => player.getForkPointers(tesuu),
    getTesuuPointer: (tesuu?: number) => player.getTesuuPointer(tesuu),
  });
}

function mergeCursorWithFuturePlan(
  cursor: KifuCursor,
  prevPlan: ForkPointer[],
): ForkPointer[] {
  return normalizeForkPointers([
    ...cursor.forkPointers,
    ...prevPlan.filter((fp) => fp.te > cursor.tesuu),
  ]);
}

function sameForkPointers(a: ForkPointer[], b: ForkPointer[]) {
  if (a.length !== b.length) return false;
  return a.every(
    (x, i) => x.te === b[i]?.te && x.forkIndex === b[i]?.forkIndex,
  );
}

export function GameProvider({ children, persistence }: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);

  const moveValidator = useMemo(() => new ShogiMoveValidator(), []);

  const player = useMemo(() => {
    if (!state.jkf || !state.cursor) return null;
    return buildPlayer(state.jkf, state.cursor);
  }, [state.jkf, state.cursor]);

  const plannedCursor = useMemo(() => {
    if (!state.cursor) return null;
    return {
      ...state.cursor,
      forkPointers: state.branchPlan,
    };
  }, [state.cursor, state.branchPlan]);

  const legalMoves = useMemo(() => {
    if (!player || !state.selectedPosition) return [];

    const shogi = player.shogi;

    try {
      if (state.selectedPosition.type === "square") {
        return moveValidator.getLegalMovesFrom(
          shogi,
          state.selectedPosition.x,
          state.selectedPosition.y,
        );
      }

      return moveValidator.getLegalDropsByKind(
        shogi,
        state.selectedPosition.color,
        state.selectedPosition.kind,
      );
    } catch {
      return [];
    }
  }, [player, state.selectedPosition, moveValidator]);

  const lastMove = useMemo(() => {
    if (!player) return null;
    return lastMovePlayer(player);
  }, [player]);

  const currentTurn = useMemo(() => {
    if (!player) return Color.Black;
    try {
      return player.shogi.turn;
    } catch {
      return Color.Black;
    }
  }, [player]);

  const currentMove = useMemo((): IMoveMoveFormat | undefined => {
    if (!player) return undefined;
    try {
      if (player.tesuu === 0) return undefined;
      return player.getMove();
    } catch {
      return undefined;
    }
  }, [player]);

  const currentComments = useMemo(() => {
    if (!player) return [];
    try {
      const comments = player.getComments();
      return Array.isArray(comments) ? comments : [];
    } catch {
      return [];
    }
  }, [player]);

  const leafTesuu = useMemo(() => {
    if (!player || !plannedCursor) return 0;
    try {
      return computeLeafTesuu(player, plannedCursor);
    } catch {
      return player.getMaxTesuu();
    }
  }, [player, plannedCursor]);

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

  const navigate = useCallback(
    (
      run: (player: JKFPlayer, branchPlan: ForkPointer[]) => boolean | void,
      errorMessage: string,
    ) => {
      if (!state.jkf || !state.cursor) return;

      try {
        dispatch({ type: "clear_error" });

        const navPlayer = buildPlayer(state.jkf, state.cursor);
        const changed = run(navPlayer, state.branchPlan);
        if (changed === false) return;

        const nextCursor = cursorFromPlayer(navPlayer);
        const nextBranchPlan = mergeCursorWithFuturePlan(
          nextCursor,
          state.branchPlan,
        );

        if (
          nextCursor.tesuuPointer === state.cursor.tesuuPointer &&
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

  const loadGame = useCallback(async (jkf: JKFData, absPath: string | null) => {
    try {
      dispatch({ type: "clear_error" });
      dispatch({ type: "set_loading", payload: true });

      const nextJkf = cloneJKF(jkf);
      const nextPlayer = new JKFPlayer(nextJkf);
      const nextCursor = cursorFromPlayer(nextPlayer);

      dispatch({
        type: "game_loaded",
        payload: {
          jkf: nextJkf,
          cursor: nextCursor,
          loadedAbsPath: absPath,
        },
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
      navigate((jkf, branchPlan) => {
        jkf.goto(index, normalizeForkPointers(branchPlan, index));
      }, "Failed to go to index");
    },
    [navigate],
  );

  const nextMove = useCallback(() => {
    navigate((jkf, branchPlan) => {
      const nextTe = jkf.tesuu + 1;
      const planned = branchPlan.find((p) => p.te === nextTe);

      if (planned && jkf.forkAndForward(planned.forkIndex)) {
        return true;
      }
      return jkf.forward();
    }, "Failed to move forward");
  }, [navigate]);

  const previousMove = useCallback(() => {
    navigate((jkf) => {
      if (jkf.tesuu <= 0) return false;
      return jkf.backward();
    }, "Failed to move backward");
  }, [navigate]);

  const goToStart = useCallback(() => {
    navigate((jkf) => {
      jkf.goto(0);
    }, "Failed to go to start");
  }, [navigate]);

  const goToEnd = useCallback(() => {
    navigate((jkf, branchPlan) => {
      const plannedMap = new Map<number, number>();
      for (const p of branchPlan) plannedMap.set(p.te, p.forkIndex);

      const startTesuu = jkf.tesuu;
      let limit = 10000;

      while (limit-- > 0) {
        const nextTe = jkf.tesuu + 1;

        const forkIndex = plannedMap.get(nextTe);
        if (forkIndex !== undefined && jkf.forkAndForward(forkIndex)) {
          continue;
        }

        const ok = jkf.forward();
        if (!ok) break;
      }

      if (limit <= 0) throw new Error("goToEnd overflows");
      if (jkf.tesuu === startTesuu) return false;
    }, "Failed to go to end");
  }, [navigate]);

  const makeMove = useCallback(
    async (move: StandardMoveFormat) => {
      if (!state.jkf || !state.cursor) return;

      try {
        dispatch({ type: "set_loading", payload: true });
        dispatch({ type: "clear_error" });

        const nextJkf = cloneJKF(state.jkf);
        const editPlayer = buildPlayer(nextJkf, state.cursor);

        applyMoveWithBranch(editPlayer, toIMoveMoveFormat(move));

        const nextCursor = cursorFromPlayer(editPlayer);
        const nextBranchPlan = [...nextCursor.forkPointers];

        dispatch({
          type: "jkf_replaced",
          payload: {
            jkf: nextJkf,
            cursor: nextCursor,
            branchPlan: nextBranchPlan,
          },
        });

        await persistIfPossible(nextJkf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to make move";
        dispatch({ type: "set_error", payload: msg });
      } finally {
        dispatch({ type: "set_loading", payload: false });
      }
    },
    [state.jkf, state.cursor, persistIfPossible],
  );

  const swapBranches = useCallback(
    async (q: SwapQuery) => {
      if (!state.jkf || !state.cursor) return;

      try {
        dispatch({ type: "clear_error" });

        const nextJkf = cloneJKF(state.jkf);
        const res = swapBranchesInKifu(nextJkf, q, state.cursor);
        if (!res.changed) return;

        const baseCursor = res.nextCursor ?? state.cursor ?? ROOT_CURSOR;
        const nextPlayer = buildPlayer(nextJkf, baseCursor);
        const nextCursor = cursorFromPlayer(nextPlayer);

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
      }
    },
    [state.jkf, state.cursor, persistIfPossible],
  );

  const deleteBranch = useCallback(
    async (q: DeleteQuery) => {
      if (!state.jkf || !state.cursor) return;

      try {
        dispatch({ type: "clear_error" });

        const nextJkf = cloneJKF(state.jkf);
        const res = deleteBranchInKifu(nextJkf, q, state.cursor);
        if (!res.changed) return;

        const baseCursor = res.nextCursor ?? state.cursor ?? ROOT_CURSOR;
        const nextPlayer = buildPlayer(nextJkf, baseCursor);
        const nextCursor = cursorFromPlayer(nextPlayer);

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
      }
    },
    [state.jkf, state.cursor, persistIfPossible],
  );

  const selectSquare = useCallback(
    async (x: number, y: number, promote?: boolean) => {
      if (!player) return;

      try {
        const shogi = player.shogi;
        const piece = shogi.get(x, y);
        const turn = shogi.turn;

        if (state.selectedPosition?.type === "hand") {
          const dropMove = legalMoves.find((m) => m.to.x === x && m.to.y === y);
          if (dropMove) {
            const standardMove = fromIMove(
              dropMove,
              state.selectedPosition.kind,
              state.selectedPosition.color,
            );
            await makeMove(standardMove);
          }
          dispatch({ type: "clear_selection" });
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

          const move = legalMoves.find((m) => m.to.x === x && m.to.y === y);
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
            dispatch({ type: "clear_selection" });
            return;
          }

          if (piece && piece.color === turn) {
            dispatch({
              type: "set_selection",
              payload: { type: "square", x, y },
            });
          } else {
            dispatch({ type: "clear_selection" });
          }
          return;
        }

        if (piece && piece.color === turn) {
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
    [player, state.selectedPosition, legalMoves, makeMove],
  );

  const selectHand = useCallback(
    (color: Color, kind: Kind) => {
      if (!player) return;

      try {
        if (color !== player.shogi.turn) {
          dispatch({ type: "clear_selection" });
          return;
        }

        const drops = moveValidator.getLegalDropsByKind(
          player.shogi,
          color,
          kind,
        );
        if (drops.length === 0) {
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
    [player, moveValidator],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "clear_selection" });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const applyCursor = useCallback(
    (cursor: KifuCursor) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "clear_error" });

        const nextPlayer = buildPlayer(state.jkf, cursor);
        const nextCursor = cursorFromPlayer(nextPlayer);
        const nextBranchPlan = mergeCursorWithFuturePlan(
          nextCursor,
          state.branchPlan,
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

  const derived: GameDerivedState = {
    player,
    legalMoves,
    lastMove,
    currentTurn,
    currentMove,
    currentComments,
    leafTesuu,
    isGameLoaded: state.jkf !== null,
    isAtStart: (state.cursor?.tesuu ?? 0) === 0,
    isAtEnd: state.cursor !== null ? state.cursor.tesuu >= leafTesuu : true,
    canGoForward:
      state.cursor !== null ? state.cursor.tesuu < leafTesuu : false,
    canGoBackward: state.cursor !== null ? state.cursor.tesuu > 0 : false,
  };

  const contextValue: GameContextType = {
    state,
    derived,
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

    getCurrentTurn: () => derived.currentTurn,
    getCurrentMoveIndex: () => state.cursor?.tesuu ?? 0,
    getTotalMoves: () => derived.leafTesuu,

    hasSelection: () => state.selectedPosition !== null,
    getCurrentMove: () => derived.currentMove,
    getCurrentComments: () => derived.currentComments,

    applyCursor,
  };

  return (
    <GameContext.Provider value={contextValue}>{children}</GameContext.Provider>
  );
}
