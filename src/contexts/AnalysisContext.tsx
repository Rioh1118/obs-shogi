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
import { startAnalysisFromSfen } from "@/commands/engine/advanced";
import { stopAnalysis } from "@/commands/engine";
import type { AnalysisResult, MultiPvCandidate } from "@/commands/engine/types";
import { usePosition } from "./PositionContext";
import {
  setupAnalysisEventListeners,
  type AnalysisEventListeners,
} from "@/commands/engine";
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

        console.log(
          `[ANALYSIS] MultiPV update: ${result.multi_pv_candidates.length} candidates`,
        );
        result.multi_pv_candidates.forEach((candidate) => {
          console.log(
            ` ${candidate.rank}: ${candidate.first_move} (評価値: ${candidate.evaluation})`,
          );
        });
      } else {
        bestMove = result.best_move?.move_str || result.pv?.[0] || null;
        principalVariation = result.pv || [];

        console.log(
          `[ANALYSIS] Single PV update: ${bestMove} (評価値: ${evaluation})`,
        );
      }

      return {
        ...state,
        analysisResults: [...state.analysisResults.slice(-9), result], // 最新10件保持
        currentDepth,
        bestMove,
        evaluation,
        principalVariation,

        isMultiPvEnabled: result.is_multi_pv_enabled,
        multiPvCandidates: result.multi_pv_candidates || [],
      };
    }
    case "set_error":
      return {
        ...state,
        error: action.payload,
        isAnalyzing: false,
      };
    case "clear_error":
      return {
        ...state,
        error: null,
      };
    case "clear_results":
      return {
        ...initialState,
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
  const { state: engineState } = useEngine();
  const { currentSfen, isPositionSynced, syncPosition } = usePosition();

  const unlistenRef = useRef<UnlistenFn | null>(null);

  const lastAnalyzedSfenRef = useRef<string | null>(null);

  useEffect(() => {
    const setupListeners = async () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }

      const listeners: AnalysisEventListeners = {
        onUpdate: (result: AnalysisResult) => {
          console.log("[ANALYSIS] Real-time result:", result);
          dispatch({ type: "update_result", payload: result });
        },
        onComplete: (sessionId: string, result: AnalysisResult) => {
          console.log("[ANALYSIS] Analysis complete:", sessionId, result);
          dispatch({ type: "update_result", payload: result });
          dispatch({ type: "stop_analysis" });
        },
        onError: (error: string) => {
          console.log("[ANALYSIS] Engine error:", error);
          dispatch({ type: "set_error", payload: error });
        },
      };

      try {
        const unlisten = await setupAnalysisEventListeners(listeners);
        unlistenRef.current = unlisten;
        console.log("[ANALYSIS] Event listeners setup complete");
      } catch (error) {
        console.error("[ANALYSIS] Failed to setup listeners:", error);
      }
    };
    setupListeners();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const handlePositionChangesDuringAnalysis = async () => {
      // 解析中でない場合は何もしない
      if (!state.isAnalyzing) {
        return;
      }

      // SFENがない場合は何もしない
      if (!currentSfen) {
        console.log(
          "🔍 [ANALYSIS] No SFEN available, ignoring position change",
        );
        return;
      }

      // エンジンの準備ができていない場合は何もしない
      if (!engineState.isReady) {
        console.log("🔍 [ANALYSIS] Engine not ready, ignoring position change");
        return;
      }

      // 前回と同じSFENの場合は何もしない
      if (lastAnalyzedSfenRef.current === currentSfen) {
        return;
      }

      try {
        console.log(
          "🔄 [ANALYSIS] Position changed during analysis, restarting...",
        );
        console.log("   Previous SFEN:", lastAnalyzedSfenRef.current);
        console.log("   New SFEN:", currentSfen);

        // 現在の解析を停止
        if (state.sessionId) {
          console.log("⏹️ [ANALYSIS] Stopping current analysis");
          await stopAnalysis(state.sessionId);
        }

        // ✅ PositionContextの syncPosition を使用
        console.log("🔄 [ANALYSIS] Syncing new position via PositionContext");
        await syncPosition();

        // 解析結果をクリア（新しい位置なので前の解析結果は無効）
        dispatch({ type: "clear_results" });

        // 新しい位置で解析を再開
        console.log("🔍 [ANALYSIS] Starting analysis with new position");
        const sessionId = await startAnalysisFromSfen(currentSfen);
        dispatch({
          type: "start_analysis",
          payload: { sessionId, position: currentSfen },
        });

        // 最後に解析したSFENを更新
        lastAnalyzedSfenRef.current = currentSfen;

        console.log("✅ [ANALYSIS] Analysis restarted successfully");
      } catch (error) {
        console.error("❌ [ANALYSIS] Failed to restart analysis:", error);
        dispatch({
          type: "set_error",
          payload: `Failed to restart analysis: ${error instanceof Error ? error.message : String(error)}`,
        });
        dispatch({ type: "stop_analysis" });
        lastAnalyzedSfenRef.current = null;
      }
    };

    handlePositionChangesDuringAnalysis();
  }, [
    currentSfen,
    state.isAnalyzing,
    state.sessionId,
    engineState.isReady,
    syncPosition,
  ]);

  // ✅ 指定SFENで解析開始
  const startInfiniteAnalysis = useCallback(async () => {
    if (!engineState.isReady) {
      throw new Error("Engine not ready");
    }

    if (!isPositionSynced || !currentSfen) {
      console.log("[ANALYSIS] Position not synced, attempting sync...");
      await syncPosition();
      if (!currentSfen) {
        throw new Error("No position available for analysis");
      }
    }

    if (state.isAnalyzing) {
      console.log("⚠️ [ANALYSIS] Already analyzing");
      return;
    }

    try {
      console.log("🔍 [ANALYSIS] Starting analysis for SFEN:", currentSfen);
      // 解析開始
      const sessionId = await startAnalysisFromSfen(currentSfen);

      dispatch({
        type: "start_analysis",
        payload: { sessionId, position: currentSfen },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Analysis failed";
      console.error("❌ [ANALYSIS] Start failed:", errorMessage);
      dispatch({ type: "set_error", payload: errorMessage });
      throw error;
    }
  }, [
    engineState.isReady,
    state.isAnalyzing,
    currentSfen,
    isPositionSynced,
    syncPosition,
  ]);

  // ✅ 解析停止
  const stopAnalysisFunc = useCallback(async () => {
    if (!state.isAnalyzing || !state.sessionId) {
      console.log("⚠️ [ANALYSIS] Not analyzing");
      return;
    }

    try {
      console.log("⏹️ [ANALYSIS] Stopping analysis:", state.sessionId);

      // エンジンの解析停止
      await stopAnalysis(state.sessionId);

      dispatch({ type: "stop_analysis" });
    } catch (error) {
      console.error("❌ [ANALYSIS] Stop failed:", error);
      // エラーでも状態はリセット
      dispatch({ type: "stop_analysis" });
    }
  }, [state.isAnalyzing, state.sessionId]);

  // ✅ 結果クリア
  const clearResults = useCallback(() => {
    dispatch({ type: "clear_results" });
  }, []);

  // ✅ エラークリア
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

  const value = useMemo(
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

// ✅ useAnalysisを別ファイルに分離するか、ここでexportを最小限に
export const useAnalysis = () => {
  const context = useContext(AnalysisContext);
  if (!context) {
    throw new Error("useAnalysis must be used within AnalysisProvider");
  }
  return context;
};
