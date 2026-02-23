import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { usePosition } from "./PositionContext";

import {
  setupAnalysisEventListeners,
  type AnalysisEventListeners,
} from "@/commands/engine";

import type { UnlistenFn } from "@tauri-apps/api/event";
import { pickTopCandidate, sortByRank } from "@/utils/analysis";
import { useEngine, type AnalysisResult } from "@/entities/engine";
import type { AnalysisCandidate } from "@/entities/engine/api/rust-types";
import {
  startInfiniteAnalysis as startInfiniteAnalysisCore,
  stopAnalysis,
} from "@/entities/engine/api/tauri";

interface AnalysisState {
  isAnalyzing: boolean;
  sessionId: string | null;
  currentPosition: string | null; // SFEN
  analysisResults: AnalysisResult[];
  candidates: AnalysisCandidate[];
  error: string | null;
}

type AnalysisAction =
  | { type: "start_analysis"; payload: { sessionId: string; position: string } }
  | { type: "stop_analysis" }
  | { type: "update_result"; payload: AnalysisResult }
  | { type: "set_error"; payload: string }
  | { type: "clear_error" }
  | { type: "clear_results" };

const initialState: AnalysisState = {
  isAnalyzing: false,
  sessionId: null,
  currentPosition: null,
  analysisResults: [],
  candidates: [],
  error: null,
};

function analysisReducer(
  state: AnalysisState,
  action: AnalysisAction,
): AnalysisState {
  switch (action.type) {
    case "start_analysis":
      return {
        ...state,
        isAnalyzing: true,
        sessionId: action.payload.sessionId,
        currentPosition: action.payload.position,
        error: null,
      };

    case "stop_analysis":
      return {
        ...state,
        isAnalyzing: false,
        sessionId: null,
      };

    case "update_result": {
      const result = action.payload;
      const candidates = sortByRank(result.candidates ?? []);

      return {
        ...state,
        analysisResults: [...state.analysisResults.slice(-9), result],
        candidates,
      };
    }

    case "set_error":
      return { ...state, error: action.payload, isAnalyzing: false };

    case "clear_error":
      return { ...state, error: null };

    case "clear_results":
      return {
        ...state,
        analysisResults: [],
        candidates: [],
        error: null,
      };

    default:
      return state;
  }
}

interface AnalysisContextType {
  state: AnalysisState;

  startInfiniteAnalysis: () => Promise<void>;
  stopAnalysis: () => Promise<void>;
  clearResults: () => void;
  clearError: () => void;

  getTopCandidate: () => AnalysisCandidate | null;
  getAllCandidates: () => AnalysisCandidate[];
}

const AnalysisContext = createContext<AnalysisContextType | null>(null);

interface AnalysisProviderProps {
  children: React.ReactNode;
}

export const AnalysisProvider: React.FC<AnalysisProviderProps> = ({
  children,
}) => {
  const [state, dispatch] = useReducer(analysisReducer, initialState);

  const { isReady } = useEngine();

  const { currentSfen, syncedSfen, syncPosition } = usePosition();

  const unlistenRef = useRef<UnlistenFn | null>(null);
  const syncedSfenRef = useRef<string | null>(syncedSfen);

  const lastAnalyzedSfenRef = useRef<string | null>(null);
  const restartInFlightRef = useRef<Promise<void> | null>(null);

  const RESTART_DEBOUNCE_MS = 100;
  const desiredSfenRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const restartSeqRef = useRef(0);
  const pendingAfterRef = useRef(false);

  useEffect(() => {
    syncedSfenRef.current = syncedSfen;
  }, [syncedSfen]);

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

  const analyzingRef = useRef(state.isAnalyzing);
  const sessionIdRef = useRef(state.sessionId);

  useEffect(() => {
    analyzingRef.current = state.isAnalyzing;
    sessionIdRef.current = state.sessionId;
  }, [state.isAnalyzing, state.sessionId]);

  // === Event listeners ===
  useEffect(() => {
    const setup = async () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      const listeners: AnalysisEventListeners = {
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
      };

      try {
        const unlisten = await setupAnalysisEventListeners(listeners);
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
          await stopAnalysis(sid);
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

  const stopAnalysisFunc = useCallback(async () => {
    desiredSfenRef.current = null;
    pendingAfterRef.current = false;
    restartSeqRef.current++;
    clearDebounceTimer();

    if (!state.isAnalyzing || !state.sessionId) {
      dispatch({ type: "stop_analysis" });
      return;
    }

    try {
      await stopAnalysis(state.sessionId);
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
      stopAnalysis: stopAnalysisFunc,
      clearResults,
      clearError,
      getTopCandidate,
      getAllCandidates,
    }),
    [
      state,
      startInfiniteAnalysis,
      stopAnalysisFunc,
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
};

export const useAnalysis = () => {
  const context = useContext(AnalysisContext);
  if (!context) {
    throw new Error("useAnalysis must be used within AnalysisProvider");
  }
  return context;
};
