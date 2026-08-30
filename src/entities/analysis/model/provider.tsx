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

  // === Event listeners ===
  useEffect(() => {
    let alive = true;

    const setup = async () => {
      safeUnlisten();

      if (!isTauri()) return;

      try {
        const unlisten = await setupAnalysisEventListeners({
          onUpdate: (result: AnalysisResult) => {
            latestResultRef.current = result;
            scheduleFlush();
          },
          onComplete: (_sessionId: string, result: AnalysisResult) => {
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
        // Rust には is_active なセッションが残り、以降 start_infinite_analysis が
        // 常に「Analysis already running」で弾かれて解析を再開できなくなる。
        const sid = sessionIdRef.current;
        void stopAnalysisCore(sid ?? undefined).catch(() => {});

        dispatch({ type: "set_error", payload: POSITION_SYNC_TIMEOUT_MESSAGE });
        dispatch({ type: "stop_analysis" });
        return;
      }

      clearDebounceTimer();
      debounceTimerRef.current = window.setTimeout(() => {
        runRestartRef.current(seq);
      }, 16);
      return;
    }

    syncWaitRef.current = null;

    if (restartInFlightRef.current) {
      pendingAfterRef.current = true;
      return;
    }

    restartInFlightRef.current = (async () => {
      try {
        const sid = sessionIdRef.current;
        if (sid) {
          await stopAnalysisCore(sid);
        }

        clearFlushTimer();
        latestResultRef.current = null;

        dispatch({ type: "clear_results" });

        clearFlushTimer();
        latestResultRef.current = null;
        const newSessionId = await startInfiniteAnalysisCore();

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
          debounceTimerRef.current = window.setTimeout(() => {
            runRestartRef.current(latestSeq);
          }, 0);
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

    debounceTimerRef.current = window.setTimeout(() => {
      runRestartRef.current(seq);
    }, RESTART_DEBOUNCE_MS);

    return () => {
      clearDebounceTimer();
    };
  }, [currentSfen, state.isAnalyzing, isReady]);

  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    if (syncedSfen !== want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (!debounceTimerRef.current && !restartInFlightRef.current) {
      const seq = restartSeqRef.current;
      debounceTimerRef.current = window.setTimeout(() => {
        runRestartRef.current(seq);
      }, 0);
    }
  }, [syncedSfen, state.isAnalyzing, isReady]);

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

    if (!state.isAnalyzing || !state.sessionId) {
      dispatch({ type: "stop_analysis" });
      return;
    }

    try {
      await stopAnalysisCore(state.sessionId);
    } finally {
      dispatch({ type: "stop_analysis" });
      clearFlushTimer();
      latestResultRef.current = null;
    }
  }, [clearFlushTimer, state.isAnalyzing, state.sessionId]);

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
