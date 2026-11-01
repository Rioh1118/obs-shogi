import { useCallback, useMemo, useReducer, useRef } from "react";
import { JKFPlayer } from "json-kifu-format";
import type { Color, Kind } from "shogi.js";

import { gameReducer } from "./reducer";
import {
  initialGameState,
  type GameContextType,
  type GameProviderProps,
  type GameView,
  type KifuLoadFailure,
  type ShogiMove,
  type StandardMoveFormat,
} from "./types";
import { GameContext, LoadedKifuPathContext } from "./context";

import type { JKFData } from "@/entities/kifu/model/jkf";
import { Err, Ok, type AsyncResult } from "@/shared/lib/result";
import {
  ROOT_CURSOR,
  asBranchPlan,
  mergeBranchPlan,
  sameForkPointers,
  type BranchPlan,
  type CursorPath,
  type KifuCursor,
} from "@/entities/kifu/model/cursor";
import { getLegalDrops, getLegalMovesFrom } from "../lib/moveValidation";
import {
  advanceToLeafWithPlan,
  advanceWithPlan,
  planByTe,
} from "@/entities/kifu/lib/advanceWithPlan";
import { applyMoveWithBranch } from "@/entities/kifu/lib/applyMoveWithBranch";
import type { BranchEditResult, DeleteQuery, SwapQuery } from "@/entities/kifu/model/branch";
import { deleteBranchInKifu, swapBranchesInKifu } from "@/entities/kifu/lib/branchEdit";
import { buildCursorView } from "../lib/cursorView";
import { fromIMove, toIMoveMoveFormat } from "../lib/moveConverter";
import { lineUsiMoves } from "../lib/usiMove";
import type { BoardLine } from "./types";
import { buildPlayer, gotoPath } from "@/entities/kifu/lib/buildPlayer";
import { cloneJkf } from "@/entities/kifu/lib/cloneJkf";
import { cursorFromPlayer, observedPointerOf } from "@/entities/kifu/lib/playerCursor";
import {
  setCommentsByCursorInKifu,
  getCommentsByCursor as getCommentsByCursorFromJkf,
} from "@/entities/kifu/lib/comment";

function errorMessageOf(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export function GameProvider({ children, persistence, moveGate }: GameProviderProps) {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);

  /**
   * 盤の着手を通す判定。
   *
   * `ref` に映すのは、`selectSquare` の依存に入れると対局の手番や時計が動くたびに
   * 着手の関数が作り直され、盤の全体が描き直されるため。
   */
  const moveGateRef = useRef(moveGate);
  moveGateRef.current = moveGate;

  /** `moveGate` へ渡すためだけに、`state.loadedAbsPath` を映す */
  const loadedPathRef = useRef(state.loadedAbsPath);
  loadedPathRef.current = state.loadedAbsPath;

  /**
   * いま盤に載っている棋譜そのもの。積む相手が入れ替わったかを同一性で決める。
   * パスで見分けると、同じファイルを開き直したときに素通りする。
   */
  const loadedJkfRef = useRef(state.jkf);
  loadedJkfRef.current = state.jkf;

  /**
   * 盤で決まった手を積んでよいかを返す。`moveGate` が無ければ常に積める。
   *
   * 対局中は Rust が採るまで積まない。積むと Rust の写しと食い違った指し手列で
   * 裁定を返すことになり、断られたまま対局が畳まれる。
   */
  const acceptsMove = useCallback(
    async (move: StandardMoveFormat, player: JKFPlayer): Promise<boolean> => {
      const gate = moveGateRef.current;
      if (gate === undefined) return true;

      const line: BoardLine = {
        kifuPath: loadedPathRef.current,
        usiMoves: lineUsiMoves(player),
      };

      // 待つ前に、積む相手を控える。`moveGate` は対局中 `submit_game_move` の往復を待つので、
      // その間に別の棋譜が載りうる。気づかずに進むと、`selectSquare` が握っている
      // 1つ前の棋譜の中身を、新しく載った棋譜の宛先へ保存する
      const before = loadedJkfRef.current;
      const accepted = await gate.accept(move, line);

      return accepted && loadedJkfRef.current === before;
    },
    [],
  );

  // 失敗を `state.error` へ積み、呼び出し元にも返す。
  //
  // `state.error` を描く部品はまだ無い（ADR-0004 決定6）。「保存済み」と出す側が成否を
  // 見られないと、書けなかった本文が画面から消えて、利用者だけが保存されたと信じる。
  const persistIfPossible = useCallback(
    async (jkfToSave: JKFData): AsyncResult<void, string> => {
      if (!persistence) {
        const msg = "保存先が決まっていません";
        dispatch({ type: "set_error", payload: msg });
        return Err(msg);
      }

      // 書き込み先が読み込んでいる棋譜と同じときだけ書く（`GamePersistence` の `absPath`）。
      // 棋譜の保存は全部 `replaceJkf` からここを通るので、検査はここ1つで足りる。
      //
      // 盤に載せられなかったとき（`game.md` の E16）は `loadedAbsPath` が据え置かれ、
      // 次の棋譜が載るまで書き込みはここで止まる。指した手は一瞬出てから戻る。
      // 理由は `GameFileTreeBridge` が断りとして出す。
      //
      // `renameLoadedPath` はこの据え置きを崩さない。橋は載せられたときだけ `jkfData` を
      // `loadedJkfDataRef` へ控えるので、載せられなかった棋譜の改名では撃たれない。
      if (persistence.absPath !== state.loadedAbsPath) {
        const msg = "保存先が切り替わったため書き込みを中止しました";
        dispatch({ type: "set_error", payload: msg });
        return Err(msg);
      }

      const res = await persistence.save(jkfToSave);
      if (!res.success) {
        // 待っている間に棋譜が別物になっていたら積まない（`write_failed`）。
        // 積むと、別のファイルの失敗が新しく開いたファイルの上に出る。
        dispatch({ type: "write_failed", payload: { error: res.error, expectedJkf: jkfToSave } });
        return Err(res.error);
      }
      return Ok(undefined);
    },
    [persistence, state.loadedAbsPath],
  );

  const cursorView = useMemo(
    () => buildCursorView(state.jkf, state.cursor, state.branchPlan),
    [state.jkf, state.cursor, state.branchPlan],
  );

  const legalMoves = useMemo<ShogiMove[]>(() => {
    const player = cursorView.player;
    const sel = state.selectedPosition;
    if (!player || !sel) return [];

    try {
      return sel.type === "square"
        ? getLegalMovesFrom(player.shogi, sel.x, sel.y)
        : getLegalDrops(player.shogi, sel.color, sel.kind);
    } catch {
      return [];
    }
  }, [cursorView.player, state.selectedPosition]);

  const view = useMemo<GameView>(
    () => ({ ...cursorView, legalMoves, hasKifu: !!cursorView.player?.shogi }),
    [cursorView, legalMoves],
  );

  const navigate = useCallback(
    (run: (player: JKFPlayer, branchPlan: BranchPlan) => boolean | void, errorMessage: string) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "clear_error" });

        const player = buildPlayer(state.jkf, state.cursor);
        const beforePointer = observedPointerOf(state.cursor, player);

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
        const msg = errorMessageOf(e, errorMessage);
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [state.jkf, state.cursor, state.branchPlan],
  );

  /**
   * 棋譜を書き換える処理を、書き込み中の数え上げと失敗の受け取りで包む。
   * 棋譜が無ければ何もせず `Ok` を返す。
   *
   * 利用者が起動していない書き込みでは `blocking` を立てない（`isLoading` の doc）。
   */
  const runWrite = useCallback(
    async (
      write: (jkf: JKFData) => AsyncResult<void, string>,
      errorMessage: string,
      blocking: boolean,
    ): AsyncResult<void, string> => {
      if (!state.jkf) return Ok(undefined);

      try {
        dispatch({ type: "write_started", payload: { blocking } });
        dispatch({ type: "clear_error" });
        return await write(state.jkf);
      } catch (e) {
        const msg = errorMessageOf(e, errorMessage);
        dispatch({ type: "set_error", payload: msg });
        return Err(msg);
      } finally {
        dispatch({ type: "write_ended", payload: { blocking } });
      }
    },
    [state.jkf],
  );

  /** 棋譜を先に置き換えてから保存し、書けなければ置き換える前へ戻す。 */
  const replaceJkf = useCallback(
    async (
      nextJkf: JKFData,
      nextCursor: KifuCursor,
      restoreCursor: boolean,
    ): AsyncResult<void, string> => {
      const before = {
        jkf: state.jkf,
        cursor: state.cursor,
        branchPlan: state.branchPlan,
      };

      dispatch({
        type: "jkf_replaced",
        payload: {
          jkf: nextJkf,
          cursor: nextCursor,
          branchPlan: asBranchPlan([...nextCursor.forkPointers]),
        },
      });

      const saved = await persistIfPossible(nextJkf);
      if (!saved.success) {
        dispatch({
          type: "jkf_restored",
          payload: { ...before, expectedJkf: nextJkf, restoreCursor },
        });
      }
      return saved;
    },
    [state.jkf, state.cursor, state.branchPlan, persistIfPossible],
  );

  // `Ok` は「棋譜が意図どおりになり、書けた」。書き込みが失敗したら `Err` を返す。
  // 何も変えなかった場合（棋譜が無い / `run` が `false` を返した / 局面が動かなかった）も
  // `Ok` にする。呼び出し側にとって「変える必要が無かった」は失敗ではない。
  const edit = useCallback(
    (
      run: (player: JKFPlayer, nextJkf: JKFData) => boolean | void,
      errorMessage: string,
      opt?: { forceCommit?: boolean; background?: boolean },
    ): AsyncResult<void, string> => {
      return runWrite(
        async (jkf) => {
          const nextJkf = cloneJkf(jkf);
          const player = buildPlayer(nextJkf, state.cursor);
          const beforePointer = observedPointerOf(state.cursor, player);

          const result = run(player, nextJkf);
          if (result === false) return Ok(undefined);

          const nextCursor = cursorFromPlayer(player);
          const moved = nextCursor.tesuuPointer !== beforePointer;
          if (!opt?.forceCommit && !moved) return Ok(undefined);

          return await replaceJkf(nextJkf, nextCursor, moved);
        },
        errorMessage,
        !opt?.background,
      );
    },
    [state.cursor, runWrite, replaceJkf],
  );

  const editBranches = useCallback(
    (
      rewrite: (jkf: JKFData, cursor: KifuCursor | null) => BranchEditResult,
      errorMessage: string,
    ): AsyncResult<void, string> => {
      return runWrite(
        async (jkf) => {
          const nextJkf = cloneJkf(jkf);
          const res = rewrite(nextJkf, state.cursor);
          if (!res.changed) return Ok(undefined);

          const baseCursor = res.nextCursor ?? state.cursor ?? ROOT_CURSOR;
          const rebuilt = buildPlayer(nextJkf, baseCursor);

          // 分岐の入れ替え・削除は自分でカーソルを動かすので、戻すときも一緒に戻す
          return await replaceJkf(nextJkf, cursorFromPlayer(rebuilt), true);
        },
        errorMessage,
        true,
      );
    },
    [state.cursor, runWrite, replaceJkf],
  );

  const loadGame = useCallback(
    async (jkf: JKFData, absPath: string): AsyncResult<void, KifuLoadFailure> => {
      try {
        dispatch({ type: "clear_error" });
        dispatch({ type: "write_started", payload: { blocking: true } });

        const nextJkf = cloneJkf(jkf);

        // 盤に載せられることを確かめる。`new JKFPlayer` は `new Shogi(kifu.initial)` を
        // 通るので、`preset: "OTHER"` で `initial.data.board` が壊れていれば投げる。
        // **`game.md` の E16 はこの1行だけが根拠。** 返り値を使わないが、消すと壊れた棋譜が
        // `state.jkf` に入り、`buildCursorView` の catch で盤が黙って空になる。
        buildPlayer(nextJkf, ROOT_CURSOR);

        dispatch({
          type: "game_loaded",
          payload: { jkf: nextJkf, absPath, cursor: ROOT_CURSOR },
        });
        return Ok(undefined);
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e);
        dispatch({ type: "set_error", payload: cause });
        // 宛先も残す。`error` は文字列なのでどのファイルの失敗か分からず、
        // その棋譜が載るのを待っている側（`usePositionHitNavigation`）が
        // 要求を捨てられない
        dispatch({ type: "load_failed", payload: { absPath } });
        // 例外の文は `shogi.js` の英文で利用者に出せないので、`code` を返す
        return Err({ code: "unplayable_initial", absPath, cause });
      } finally {
        dispatch({ type: "write_ended", payload: { blocking: true } });
      }
    },
    [],
  );

  const resetGame = useCallback(() => {
    dispatch({ type: "reset_state" });
  }, []);

  const renameLoadedPath = useCallback((absPath: string) => {
    dispatch({ type: "path_renamed", payload: { absPath } });
  }, []);

  const goToIndex = useCallback(
    (index: number) => {
      navigate((player, branchPlan) => {
        gotoPath(player, { tesuu: index, forkPointers: branchPlan });
      }, "Failed to go to index");
    },
    [navigate],
  );

  const nextMove = useCallback(() => {
    navigate((player, branchPlan) => {
      return advanceWithPlan(player, planByTe(branchPlan)).moved;
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
      gotoPath(player, ROOT_CURSOR);
    }, "Failed to go to start");
  }, [navigate]);

  const goToEnd = useCallback(() => {
    navigate((player, branchPlan) => {
      const startTesuu = player.tesuu;
      advanceToLeafWithPlan(player, planByTe(branchPlan));
      if (player.tesuu === startTesuu) return false;
    }, "Failed to go to end");
  }, [navigate]);

  const makeMove = useCallback(
    async (move: StandardMoveFormat): AsyncResult<void, string> => {
      return await edit((player) => {
        applyMoveWithBranch(player, toIMoveMoveFormat(move));
      }, "Failed to make move");
    },
    [edit],
  );

  const swapBranches = useCallback(
    (q: SwapQuery) => {
      const swap = (jkf: JKFData, cursor: KifuCursor | null) => swapBranchesInKifu(jkf, q, cursor);
      return editBranches(swap, "Failed to swap branches");
    },
    [editBranches],
  );

  const deleteBranch = useCallback(
    (q: DeleteQuery) => {
      const remove = (jkf: JKFData, cursor: KifuCursor | null) =>
        deleteBranchInKifu(jkf, q, cursor);
      return editBranches(remove, "Failed to delete branch");
    },
    [editBranches],
  );

  const getCommentsByCursor = useCallback(
    (cursor: CursorPath | null) => {
      if (!state.jkf) return [];

      try {
        return getCommentsByCursorFromJkf(state.jkf, cursor);
      } catch {
        return [];
      }
    },
    [state.jkf],
  );

  const setCommentsByCursor = useCallback(
    (cursor: CursorPath, comments: string[]): AsyncResult<void, string> =>
      edit(
        (_player, nextJkf) => {
          const result = setCommentsByCursorInKifu(nextJkf, cursor, comments);

          if (!result.ok) {
            // この文字列はノートの赤い箱にそのまま出る。同じ場所を指し続ける間は書き直しても
            // 直らないので、何をすれば直るかを書く。
            throw new Error(
              "この手が棋譜の中に見つかりませんでした。棋譜が変わっている可能性があります。ノートを閉じて開き直してください",
            );
          }

          return result.changed;
        },
        "Failed to update comments",
        // 自動保存は利用者が起動しない。棋譜一覧の行を止めない
        { forceCommit: true, background: true },
      ),
    [edit],
  );

  const playIfAccepted = useCallback(
    async (move: StandardMoveFormat, player: JKFPlayer) => {
      // 採られなければ選択だけ解く
      if (!(await acceptsMove(move, player))) {
        dispatch({ type: "clear_selection" });
        return;
      }
      await makeMove(move); // async-result-ignored: 盤には出す場所が無い → #277
    },
    [makeMove, acceptsMove],
  );

  const selectSquare = useCallback(
    async (x: number, y: number, promote?: boolean) => {
      const player = view.player;
      if (!player) return;

      try {
        const shogi = player.shogi;
        const piece = shogi.get(x, y);
        const selected = state.selectedPosition;
        const legalMove = view.legalMoves.find((m) => m.to.x === x && m.to.y === y);

        if (selected?.type === "hand") {
          if (legalMove) {
            await playIfAccepted(fromIMove(legalMove, selected.kind, selected.color), player);
          } else {
            dispatch({ type: "clear_selection" });
          }
          return;
        }

        if (selected?.x === x && selected.y === y) {
          dispatch({ type: "clear_selection" });
          return;
        }

        if (selected && legalMove) {
          const fromPiece = shogi.get(selected.x, selected.y);
          if (fromPiece) {
            const move = fromIMove(legalMove, fromPiece.kind, fromPiece.color, promote);
            await playIfAccepted(move, player);
          }
          return;
        }

        if (piece?.color === shogi.turn) {
          dispatch({
            type: "set_selection",
            payload: { type: "square", x, y },
          });
        } else {
          dispatch({ type: "clear_selection" });
        }
      } catch (e) {
        const msg = errorMessageOf(e, "Failed to select square");
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [view.player, view.legalMoves, state.selectedPosition, playIfAccepted],
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

        if (getLegalDrops(player.shogi, color, kind).length === 0) {
          dispatch({ type: "clear_selection" });
          return;
        }

        dispatch({
          type: "set_selection",
          payload: { type: "hand", color, kind },
        });
      } catch (e) {
        const msg = errorMessageOf(e, "Failed to select hand");
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [view.player],
  );

  const clearSelection = useCallback(() => {
    dispatch({ type: "clear_selection" });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const canGoForward = useCallback(() => {
    return (state.cursor?.tesuu ?? 0) < view.totalMoves;
  }, [state.cursor, view.totalMoves]);

  const canGoBackward = useCallback(() => {
    return (state.cursor?.tesuu ?? 0) > 0;
  }, [state.cursor]);

  const getCurrentTurn = useCallback(() => view.currentTurn, [view.currentTurn]);

  const getCurrentMoveIndex = useCallback(() => {
    return state.cursor?.tesuu ?? 0;
  }, [state.cursor]);

  const getTotalMoves = useCallback(() => view.totalMoves, [view.totalMoves]);

  const applyCursor = useCallback(
    (cursor: CursorPath) => {
      if (!state.jkf) return;

      try {
        dispatch({ type: "clear_error" });

        const nextPlayer = buildPlayer(state.jkf, cursor);
        const nextCursor = cursorFromPlayer(nextPlayer);
        const nextBranchPlan = mergeBranchPlan(nextCursor, state.branchPlan, cursor.forkPointers);

        dispatch({
          type: "navigated",
          payload: {
            cursor: nextCursor,
            branchPlan: nextBranchPlan,
          },
        });
      } catch (e) {
        const msg = errorMessageOf(e, "Failed to apply cursor");
        dispatch({ type: "set_error", payload: msg });
      }
    },
    [state.jkf, state.branchPlan],
  );

  const contextValue = useMemo<GameContextType>(
    () => ({
      state,
      view,
      loadGame,
      resetGame,
      renameLoadedPath,
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
      getCommentsByCursor,
      setCommentsByCursor,
      clearError,
      canGoForward,
      canGoBackward,
      getCurrentTurn,
      getCurrentMoveIndex,
      getTotalMoves,
      applyCursor,
    }),
    [
      state,
      view,
      loadGame,
      resetGame,
      renameLoadedPath,
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
      getCommentsByCursor,
      setCommentsByCursor,
      clearError,
      canGoForward,
      canGoBackward,
      getCurrentTurn,
      getCurrentMoveIndex,
      getTotalMoves,
      applyCursor,
    ],
  );

  return (
    <GameContext.Provider value={contextValue}>
      <LoadedKifuPathContext.Provider value={state.loadedAbsPath}>
        {children}
      </LoadedKifuPathContext.Provider>
    </GameContext.Provider>
  );
}
