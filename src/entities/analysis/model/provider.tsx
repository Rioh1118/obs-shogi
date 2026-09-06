import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { AnalysisContextType, PositionSyncAdapter } from "./types";
import {
  startInfiniteAnalysis as startInfiniteAnalysisCore,
  stopAnalysis as stopAnalysisCore,
} from "@/entities/engine/api/tauri";
import { analysisReducer, initialState } from "./reducer";
import { useEngine, type AnalysisResult } from "@/entities/engine";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { setupAnalysisEventListeners } from "@/entities/engine/api/events";
import type { AnalysisCandidate } from "@/entities/engine";
import { pickTopCandidate } from "../lib/candidates";
import { AnalysisContext } from "./context";

interface Props {
  children: ReactNode;
  positionSync: PositionSyncAdapter;
}

export function AnalysisProvider({ children, positionSync }: Props) {
  const [state, dispatch] = useReducer(analysisReducer, initialState);

  const { isReady } = useEngine();

  const { currentSfen, syncedSfen, syncPosition } = positionSync;

  const unlistenRef = useRef<UnlistenFn | null>(null);

  const syncedSfenRef = useRef<string | null>(syncedSfen);
  const analyzingRef = useRef(state.isAnalyzing);
  const sessionIdRef = useRef(state.sessionId);

  const latestResultRef = useRef<AnalysisResult | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const RESULT_FLUSH_MS = 80;

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushLatest = useCallback(() => {
    // 解析中じゃないならUI更新しない（stop直後の無駄更新防止）
    if (!analyzingRef.current) return;

    const r = latestResultRef.current;
    if (!r) return;

    dispatch({ type: "update_result", payload: r });
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current != null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushLatest();
    }, RESULT_FLUSH_MS);
  }, [flushLatest, RESULT_FLUSH_MS]);

  const safeUnlisten = useCallback(() => {
    const fn = unlistenRef.current;
    unlistenRef.current = null;
    if (!fn) return;

    try {
      fn();
    } catch (e) {
      console.debug("[ANALYSIS] unlisten failed (ignored)", e);
    }
  }, []);

  useEffect(() => {
    syncedSfenRef.current = syncedSfen;
  }, [syncedSfen]);

  useEffect(() => {
    analyzingRef.current = state.isAnalyzing;
    sessionIdRef.current = state.sessionId;
  }, [state.isAnalyzing, state.sessionId]);

  const lastAnalyzedSfenRef = useRef<string | null>(null);
  const restartInFlightRef = useRef<Promise<void> | null>(null);

  const desiredSfenRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const restartSeqRef = useRef(0);
  // 自動再開の同期待ち。打ち切りの判定に使う。
  // 待っている対象（seq と局面）ごと持つ。時刻だけを持つと、前回の待ちの経過時間を
  // 引き継いで、次の待ちを1ミリ秒も待たずに打ち切ってしまう。
  const syncWaitRef = useRef<{ seq: number; want: string; startedAt: number } | null>(null);
  const pendingAfterRef = useRef(false);

  const RESTART_DEBOUNCE_MS = 100;

  // エンジンが position を受け付けるまで待つ上限。これを超えたら送信できていないと
  // 見なし、盤面と一致しない候補手を出さないために解析を始めない。
  // 根拠は実測ではないので、重い評価関数の初期化で足りなければ引き上げてよい。
  const POSITION_SYNC_TIMEOUT_MS = 2000;
  const POSITION_SYNC_TIMEOUT_MESSAGE = "エンジンに現在の局面を送れませんでした";

  const waitUntil = async (cond: () => boolean, timeoutMs: number) => {
    const start = Date.now();
    while (!cond()) {
      if (Date.now() - start > timeoutMs) return false;
      await new Promise((r) => setTimeout(r, 16));
    }
    return true;
  };

  const clearDebounceTimer = () => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  // **Rust が渡した席を、握った行で持つ。** `state` の写し（`analyzingRef` /
  // `sessionIdRef`）では代われない——あれを書くのは commit の後の effect なので、
  // 開始の応答が返った直後に畳まれた回は空のまま残り、席が在るのに「無い」と読む。
  //
  // 返せたときだけ手放す。**停止が失敗したら握ったまま**にして、次に返せる機会
  // （畳まれたとき）へ持ち越す。手放してしまうと、席の存在を知る者が誰も居なくなる。
  const seatRef = useRef<string | null>(null);

  // 席を返す口をここ1つにする。散らすと、経路を1つ足すたびに返し忘れが1つ増える。
  const releaseSeat = async (sessionId?: string) => {
    await stopAnalysisCore(sessionId);

    // 指した相手が既に居なくても Rust は `Ok` を返す（`bridge.rs` の `stop_session`）。
    // ここまで来た時点で、その席は空いている。
    // **自分が握っている席と違うなら手放さない。** 新しい席を巻き添えにする。
    if (sessionId === undefined || seatRef.current === sessionId) {
      seatRef.current = null;
    }
  };

  // 応答を待てない場所（畳まれた後・打ち切り）から返す。
  //
  // **落ちても利用者には出せない**——ここを通るのは画面が既に無いか、
  // 直後に別のエラーを出す場面。**それでも痕跡は残す。** ここが最後の防壁で、
  // 抜けられると席が残り、以降の解析が全部「Analysis already running」で
  // 断られる。しかもその失敗は「▶ を押しても何も起きない」という形でしか
  // 現れない（`docs/state-transitions/analysis.md` ※4）ので、
  // ログが無いと原因に辿り着く手掛かりが1つも無い。
  const releaseSeatQuietly = (sessionId?: string) => {
    void releaseSeat(sessionId).catch((e) => {
      console.warn("[ANALYSIS] failed to release the engine session", sessionId, e);
    });
  };

  // 畳まれた画面が握っている席を返す。
  //
  // React の state が消えても、Rust の `active_sessions` からは席が消えない。
  // 置いていくと、以降 start_infinite_analysis が「Analysis already running」で
  // 断られ、エンジンを畳み直すまで解析が二度と始まらない。
  //
  // **セッションを指さない。** 指した ID が席の主でなければ Rust は照合して断り
  // （`bridge.rs` の `stop_session`）、席は残ったままになる。握っている ID が
  // 主とずれる経路は在る——停止が落ちて握り続けた回と、完了通知の ID が
  // 一致しなかった回。画面が居ない以上どの解析も要らないので、指さずに全部返す。
  const releaseSeatOnUnmount = () => {
    if (seatRef.current === null) return;
    releaseSeatQuietly();
  };

  const unmountedRef = useRef(false);

  // 畳まれたときに、この画面が残していくものを断つ。**2つある。**
  //
  // - 再開のタイマー。局面を見る effect の cleanup だけでは足りない——早期 return を
  //   踏んだ回は cleanup を登録しないので、その回に張られた分を止める者が残らない。
  //   残ると、居ない画面のためにエンジンへ go を出し、window の消えたテスト環境では
  //   タイマー自身が投げる
  // - Rust の席。→ `releaseSeatOnUnmount`
  useEffect(() => {
    // **setup で戻す。** cleanup で落とすだけだと、同じインスタンスに
    // setup → cleanup → setup が走ったとき（StrictMode）に true のまま残り、
    // 以降タイマーが1つも張られず、盤を進めても解析が黙って再開しなくなる。
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;
      clearDebounceTimer();
      releaseSeatOnUnmount();
    };
  }, []);

  // === Event listeners ===
  useEffect(() => {
    let alive = true;

    const setup = async () => {
      safeUnlisten();

      if (!isTauri()) return;

      try {
        const unlisten = await setupAnalysisEventListeners({
          onUpdate: (sessionId: string, result: AnalysisResult) => {
            // **自分のセッションのものだけ採る。** 前の探索が畳まりきる前に
            // 次の `go` が出ると、古い局面の `info` がこちらへ配られる。
            // 採ると、前の局面の評価値と読み筋が現在の盤面の解析結果として出る
            if (sessionIdRef.current !== null && sessionId !== sessionIdRef.current) return;
            latestResultRef.current = result;
            scheduleFlush();
          },
          onComplete: (sessionId: string, result: AnalysisResult) => {
            // 終わった探索の席は Rust が自分で片付ける（`bridge.rs` の
            // `forward_results_to_ui`）。**握っている席と一致するときだけ手放す。**
            // 一致しないまま手放すと、走っている別の席を知る者が居なくなる。
            // 一致しない側に倒したときの損は、畳んだときに空振りの停止が1本出るだけ。
            if (seatRef.current === sessionId) seatRef.current = null;

            latestResultRef.current = result;
            clearFlushTimer();
            flushLatest();
            dispatch({ type: "stop_analysis" });
          },
          onError: (error: string) => {
            dispatch({ type: "set_error", payload: error });
          },
        });

        if (!alive) {
          unlisten();
          return;
        }
        unlistenRef.current = unlisten;
      } catch (e) {
        console.error("[ANALYSIS] Failed to setup listeners:", e);
      }
    };

    setup();

    return () => {
      alive = false;
      clearFlushTimer();
      safeUnlisten();
    };
  }, [safeUnlisten, scheduleFlush, clearFlushTimer, flushLatest]);

  const runRestartRef = useRef<(seq: number) => void>(() => {});

  // 再開のタイマーを張る口をここ1つにする。畳まれた後に張ると、それを止める
  // cleanup はもう走らない。非同期の再開が返ってきた後の張り直しは、まさにそこを通る。
  const scheduleRestart = useCallback((seq: number, delayMs: number) => {
    if (unmountedRef.current) return;
    debounceTimerRef.current = window.setTimeout(() => {
      runRestartRef.current(seq);
    }, delayMs);
  }, []);

  runRestartRef.current = (seq: number) => {
    if (restartSeqRef.current !== seq) return;
    if (!analyzingRef.current) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (syncedSfen !== want) {
      // 同期を待つ。手動開始と同じ上限で打ち切る。上限が無いと、同期が恒久的に
      // 失敗したときに「解析中」の表示のままタイマーだけが回り続け、
      // 利用者には何も起きていないのに正常に見える。
      const prev = syncWaitRef.current;
      const startedAt =
        prev && prev.seq === seq && prev.want === want ? prev.startedAt : Date.now();
      syncWaitRef.current = { seq, want, startedAt };

      if (Date.now() - startedAt > POSITION_SYNC_TIMEOUT_MS) {
        syncWaitRef.current = null;
        clearDebounceTimer();

        // エンジン側のセッションも必ず止める。React の state だけ落とすと
        // Rust には席が残り、以降 start_infinite_analysis が
        // 常に「Analysis already running」で弾かれて解析を再開できなくなる。
        releaseSeatQuietly(seatRef.current ?? undefined);

        dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
        dispatch({ type: "stop_analysis" });
        return;
      }

      clearDebounceTimer();
      scheduleRestart(seq, 16);
      return;
    }

    syncWaitRef.current = null;

    if (restartInFlightRef.current) {
      pendingAfterRef.current = true;
      return;
    }

    restartInFlightRef.current = (async () => {
      try {
        const held = seatRef.current;
        if (held) {
          await releaseSeat(held);
        }

        clearFlushTimer();
        latestResultRef.current = null;

        dispatch({ type: "clear_results" });

        clearFlushTimer();
        latestResultRef.current = null;

        // 停止の応答を待っている間に畳まれていることがある。ここで go を出すと、
        // 誰も見ていない探索が走り、それを止める者もいない。
        if (unmountedRef.current) return;

        const newSessionId = await startInfiniteAnalysisCore();
        seatRef.current = newSessionId;

        // 応答を待っている間に、畳まれるか、利用者が停止を押している。
        //
        // 畳まれた場合: 後始末の一括停止がこの席より先に Rust へ届いていれば、
        // 席は残ったまま——順序はどちらにもなるので、返ってきた側でも返す。
        // 停止された場合: `stopAnalysis` は世代を上げるが、撃てるのは
        // その時点で握っている古い席だけ。**この席を返せるのはここだけ。**
        // 返さずに `start_analysis` を dispatch すると、止めたはずの解析が
        // 画面でも Rust でも走り直す。
        if (unmountedRef.current || restartSeqRef.current !== seq) {
          releaseSeatQuietly(newSessionId);
          return;
        }

        dispatch({
          type: "start_analysis",
          payload: { sessionId: newSessionId, position: want },
        });

        lastAnalyzedSfenRef.current = want;
      } catch (e) {
        dispatch({
          type: "set_error",
          payload: `Failed to restart analysis: ${e instanceof Error ? e.message : String(e)}`,
        });
        dispatch({ type: "stop_analysis" });
        lastAnalyzedSfenRef.current = null;
      } finally {
        restartInFlightRef.current = null;

        if (pendingAfterRef.current) {
          pendingAfterRef.current = false;
          const latestSeq = restartSeqRef.current;
          clearDebounceTimer();
          scheduleRestart(latestSeq, 0);
        }
      }
    })();
  };

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;
    if (!currentSfen) return;
    if (lastAnalyzedSfenRef.current === currentSfen) return;

    desiredSfenRef.current = currentSfen;

    clearDebounceTimer();
    const seq = ++restartSeqRef.current;

    scheduleRestart(seq, RESTART_DEBOUNCE_MS);

    return () => {
      clearDebounceTimer();
    };
  }, [currentSfen, state.isAnalyzing, isReady, scheduleRestart]);

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    if (syncedSfen !== want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (!debounceTimerRef.current && !restartInFlightRef.current) {
      scheduleRestart(restartSeqRef.current, 0);
    }
  }, [syncedSfen, state.isAnalyzing, isReady, scheduleRestart]);

  const startInfiniteAnalysis = useCallback(async () => {
    if (!isReady) throw new Error("Engine not ready");
    if (state.isAnalyzing) return;
    if (!currentSfen) throw new Error("No position available for analysis");

    await syncPosition();

    // 送れていないまま解析を始めると、エンジンには別の局面が入ったまま
    // 候補手が返ってきて、盤面と一致しないものが表示される。
    const synced = await waitUntil(
      () => syncedSfenRef.current === currentSfen,
      POSITION_SYNC_TIMEOUT_MS,
    );
    if (!synced) {
      dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
      throw new Error(POSITION_SYNC_TIMEOUT_MESSAGE);
    }

    const sessionId = await startInfiniteAnalysisCore();
    seatRef.current = sessionId;

    // 席を頼んでから返ってくるまでの間に畳まれることがある。畳んだときの
    // 一括停止は、この席が Rust に載る前に届いていれば何も掃かない
    // ——返せるのはここだけ。
    if (unmountedRef.current) {
      releaseSeatQuietly(sessionId);
      return;
    }

    dispatch({
      type: "start_analysis",
      payload: { sessionId, position: currentSfen },
    });

    lastAnalyzedSfenRef.current = currentSfen;
    desiredSfenRef.current = currentSfen;
  }, [isReady, state.isAnalyzing, currentSfen, syncPosition]);

  const stopAnalysis = useCallback(async () => {
    desiredSfenRef.current = null;
    pendingAfterRef.current = false;
    restartSeqRef.current++;
    clearDebounceTimer();

    // **席を持っているかは1つの式で決める。** 畳まれたときの後始末と別の式にすると、
    // `set_error` で `sessionId` だけ残った状態（`reducer.ts`）で答えが割れ、
    // 片方は返しにいき、片方は state だけ落として席を置き去りにする。
    const held = seatRef.current;
    if (!held) {
      dispatch({ type: "stop_analysis" });
      return;
    }

    try {
      await releaseSeat(held);
    } finally {
      dispatch({ type: "stop_analysis" });
      clearFlushTimer();
      latestResultRef.current = null;
    }
  }, [clearFlushTimer]);

  const clearResults = useCallback(() => {
    dispatch({ type: "clear_results" });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const getTopCandidate = useCallback((): AnalysisCandidate | null => {
    return pickTopCandidate(state.candidates);
  }, [state.candidates]);

  const getAllCandidates = useCallback((): AnalysisCandidate[] => {
    return state.candidates;
  }, [state.candidates]);

  const value = useMemo<AnalysisContextType>(
    () => ({
      state,
      startInfiniteAnalysis,
      stopAnalysis,
      clearResults,
      clearError,
      getTopCandidate,
      getAllCandidates,
    }),
    [
      state,
      startInfiniteAnalysis,
      stopAnalysis,
      clearResults,
      clearError,
      getTopCandidate,
      getAllCandidates,
    ],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}
