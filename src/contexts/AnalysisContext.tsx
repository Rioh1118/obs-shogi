import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

import { useEngine } from "./EngineContext";
import { usePosition } from "./PositionContext";

import {
  setupAnalysisEventListeners,
  type AnalysisEventListeners,
  stopAnalysis,
  startInfiniteAnalysis as startInfiniteAnalysisCore,
} from "@/commands/engine";

import type { AnalysisResult, MultiPvCandidate } from "@/commands/engine/types";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface AnalysisState {
  isAnalyzing: boolean;
  sessionId: string | null;
  currentPosition: string | null; // SFEN
  analysisResults: AnalysisResult[];
  currentDepth: number;
  bestMove: string | null;
  evaluation: number | null;
  principalVariation: string[];
  isMultiPvEnabled: boolean;
  multiPvCandidates: MultiPvCandidate[];
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
  currentDepth: 0,
  bestMove: null,
  evaluation: null,
  principalVariation: [],
  isMultiPvEnabled: false,
  multiPvCandidates: [],
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
      const result = action.payload as AnalysisResult;

      const currentDepth = result.depth || 0;
      const evaluation = result.evaluation || null;

      let bestMove: string | null = null;
      let principalVariation: string[] = [];

      if (result.is_multi_pv_enabled && result.multi_pv_candidates.length > 0) {
        const topCandidate =
          result.multi_pv_candidates.find((c) => c.rank === 1) ||
          result.multi_pv_candidates[0];

        bestMove = topCandidate.first_move;
        principalVariation = topCandidate.pv_line;
      } else {
        bestMove = result.best_move?.move_str || result.pv?.[0] || null;
        principalVariation = result.pv || [];
      }

      return {
        ...state,
        analysisResults: [...state.analysisResults.slice(-9), result],
        currentDepth,
        bestMove,
        evaluation,
        principalVariation,
        isMultiPvEnabled: result.is_multi_pv_enabled,
        multiPvCandidates: result.multi_pv_candidates || [],
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
        currentDepth: 0,
        bestMove: null,
        evaluation: null,
        principalVariation: [],
        isMultiPvEnabled: false,
        multiPvCandidates: [],
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

  getTopCandidate: () => MultiPvCandidate | null;
  getAllCandidates: () => MultiPvCandidate[];
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

  // PositionContext 側で setPosition を直列化・dedupe している前提
  // ★ syncedSfen を「エンジンに反映済みSFEN」として使う
  const { currentSfen, syncedSfen, isPositionSynced, syncPosition } =
    usePosition();

  const unlistenRef = useRef<UnlistenFn | null>(null);

  // 最後に「解析を開始した（start_analysis した）」局面
  const lastAnalyzedSfenRef = useRef<string | null>(null);

  // stop/start の同時実行防止
  const restartInFlightRef = useRef<Promise<void> | null>(null);

  // === trailing-only restart (100ms) ===
  const RESTART_DEBOUNCE_MS = 100;
  const desiredSfenRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<number | null>(null);
  const restartSeqRef = useRef(0);
  const pendingAfterRef = useRef(false);

  const clearDebounceTimer = () => {
    if (debounceTimerRef.current) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  // async 内で stale 参照になりがちなので ref に逃がす
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

    setup().catch(() => {});

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  // restart 実体（refに入れて循環依存を避ける）
  const runRestartRef = useRef<(seq: number) => void>(() => {});
  runRestartRef.current = (seq: number) => {
    // 古い要求は無視
    if (restartSeqRef.current !== seq) return;

    if (!analyzingRef.current) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    // すでにこの局面で解析しているなら何もしない
    if (lastAnalyzedSfenRef.current === want) return;

    // synced が追いついてないなら 1 frame 後に再試行（trailingは維持）
    if (syncedSfen !== want) {
      clearDebounceTimer();
      debounceTimerRef.current = window.setTimeout(() => {
        runRestartRef.current(seq);
      }, 16);
      return;
    }

    // stop/start 多重防止：実行中なら「終わったらもう一回」フラグだけ立てる
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

        // UI上、空にしたくないならここを消して stale 表示にするのがオススメ
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

        // 実行中にさらに局面が変わっていたら、最新に追従してもう一回
        if (pendingAfterRef.current) {
          pendingAfterRef.current = false;

          // 最新seqで再試行（もし synced 待ちなら runRestartRef が待つ）
          const latestSeq = restartSeqRef.current;
          clearDebounceTimer();
          debounceTimerRef.current = window.setTimeout(() => {
            runRestartRef.current(latestSeq);
          }, 0);
        }
      }
    })();
  };

  // ✅ 解析中に局面が変わったら：restartを “50ms trailing-only” でスケジュール
  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;
    if (!currentSfen) return;

    // 同じ局面なら何もしない
    if (lastAnalyzedSfenRef.current === currentSfen) return;

    desiredSfenRef.current = currentSfen;

    // trailing-only: タイマーをリセットして最後の変更だけ拾う
    clearDebounceTimer();
    const seq = ++restartSeqRef.current;

    debounceTimerRef.current = window.setTimeout(() => {
      runRestartRef.current(seq);
    }, RESTART_DEBOUNCE_MS);

    return () => {
      // StrictMode 対策で cleanup でタイマーを殺す
      clearDebounceTimer();
    };
  }, [currentSfen, state.isAnalyzing, isReady]);

  // ✅ syncedSfen が追いついた瞬間に「待ってたrestart」を早めに実行したい場合（体感改善）
  useEffect(() => {
    if (!state.isAnalyzing) return;
    if (!isReady) return;

    const want = desiredSfenRef.current;
    if (!want) return;

    if (syncedSfen !== want) return;
    if (lastAnalyzedSfenRef.current === want) return;

    // すでにdebounce待ちなら放置、なければ即時に近い形で起動
    if (!debounceTimerRef.current && !restartInFlightRef.current) {
      const seq = restartSeqRef.current;
      debounceTimerRef.current = window.setTimeout(() => {
        runRestartRef.current(seq);
      }, 0);
    }
  }, [syncedSfen, state.isAnalyzing, isReady]);

  // ✅ start（ボタン）
  const startInfiniteAnalysis = useCallback(async () => {
    if (!isReady) throw new Error("Engine not ready");
    if (state.isAnalyzing) return;
    if (!currentSfen) throw new Error("No position available for analysis");

    // 開始時点で未同期なら同期を促す（PositionContext側が直列化してくれる前提）
    if (!isPositionSynced || syncedSfen !== currentSfen) {
      await syncPosition();
    }

    // 「同期されたらstart」したいので、軽く待つ（最大300ms）
    // ※ ここを消しても動くが、レースで一瞬ズレるのが嫌なら入れておく
    const waitStart = Date.now();
    while (Date.now() - waitStart < 300) {
      if (syncedSfen === currentSfen) break;
      await new Promise((r) => setTimeout(r, 16));
    }

    const sessionId = await startInfiniteAnalysisCore();

    dispatch({
      type: "start_analysis",
      payload: { sessionId, position: currentSfen },
    });

    lastAnalyzedSfenRef.current = currentSfen;
    desiredSfenRef.current = currentSfen;
  }, [
    isReady,
    state.isAnalyzing,
    currentSfen,
    isPositionSynced,
    syncedSfen,
    syncPosition,
  ]);

  // ✅ stop（ボタン）
  const stopAnalysisFunc = useCallback(async () => {
    // これ以上 restart が走らないように止める
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

  const getTopCandidate = useCallback((): MultiPvCandidate | null => {
    if (!state.isMultiPvEnabled || state.multiPvCandidates.length === 0) {
      return null;
    }
    return (
      state.multiPvCandidates.find((c) => c.rank === 1) ||
      state.multiPvCandidates[0]
    );
  }, [state.isMultiPvEnabled, state.multiPvCandidates]);

  const getAllCandidates = useCallback((): MultiPvCandidate[] => {
    return state.multiPvCandidates;
  }, [state.multiPvCandidates]);

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
