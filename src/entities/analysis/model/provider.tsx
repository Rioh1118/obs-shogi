import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import type { AnalysisContextType, PositionSyncAdapter } from "./types";
import {
  startInfiniteAnalysis as startInfiniteAnalysisCore,
  stopAnalysis as stopAnalysisCore,
} from "@/entities/engine/api/tauri";
import { analysisReducer, initialState } from "./reducer";
import { useEngine, type AnalysisResult } from "@/entities/engine";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { setupAnalysisEventListeners } from "@/entities/engine/api/events";
import type { AnalysisCandidate } from "@/entities/engine/api/rust-types";
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
  const pendingAfterRef = useRef(false);

  const RESTART_DEBOUNCE_MS = 100;

  const waitUntil = async (cond: () => boolean, timeoutMs = 1500) => {
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
    const setup = async () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      try {
        const unlisten = await setupAnalysisEventListeners({
          onUpdate: (result: AnalysisResult) => {
            dispatch({ type: "update_result", payload: result });
          },
          onComplete: (_sessionId: string, result: AnalysisResult) => {
            dispatch({ type: "update_result", payload: result });
            dispatch({ type: "stop_analysis" });
          },
          onError: (error: string) => {
            dispatch({ type: "set_error", payload: error });
          },
        });
        unlistenRef.current = unlisten;
      } catch (e) {
        console.error("[ANALYSIS] Failed to setup listeners:", e);
      }
    };

    setup().catch((e) => {
      console.error("[ANALYSIS] Failed to setup listeners:", e);
    });

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const runRestartRef = useRef<(seq: number) => void>(() => {});
  runRestartRef.current = (seq: number) => {
    if (restartSeqRef.current !== seq) return;
    if (!analyzingRef.current) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    if (syncedSfen !== want) {
      clearDebounceTimer();
      debounceTimerRef.current = window.setTimeout(() => {
        runRestartRef.current(seq);
      }, 16);
      return;
    }

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

        dispatch({ type: "clear_results" });

        const newSessionId = await startInfiniteAnalysisCore();

        dispatch({
          type: "start_analysis",
          payload: { sessionId: newSessionId, position: want },
        });

        lastAnalyzedSfenRef.current = want;
      } catch (e) {
        dispatch({
          type: "set_error",
          payload: `Failed to restart analysis: ${
            e instanceof Error ? e.message : String(e)
          }`,
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

    await waitUntil(() => syncedSfenRef.current === currentSfen, 2000);

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
    }
  }, [state.isAnalyzing, state.sessionId]);

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

  return (
    <AnalysisContext.Provider value={value}>
      {children}
    </AnalysisContext.Provider>
  );
}
