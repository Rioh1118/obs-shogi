import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useEngine } from "./EngineContext";
import {
  startAnalysisFromSfen,
  pollAnalysisResult,
} from "@/commands/engine/advanced";
import { stopAnalysis } from "@/commands/engine";
import type { AnalysisResult } from "@/commands/engine/types";
import { usePosition } from "./PositionContext";

interface AnalysisState {
  isAnalyzing: boolean;
  sessionId: string | null;
  currentPosition: string | null; // SFEN
  analysisResults: AnalysisResult[];
  currentDepth: number;
  bestMove: string | null;
  evaluation: number | null;
  principalVariation: string[];
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
      // ✅ ブロックスコープで変数宣言
      const result = action.payload;
      const currentDepth = result.depth_info?.depth || 0; // ✅ depth_info から取得
      const bestMove = result.principal_variations[0]?.moves[0] || null;
      const evaluation = result.evaluation?.value || null;
      const principalVariation = result.principal_variations[0]?.moves || [];

      return {
        ...state,
        analysisResults: [...state.analysisResults.slice(-9), result], // 最新10件保持
        currentDepth,
        bestMove,
        evaluation,
        principalVariation,
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

  // ポーリング停止用ref
  const stopPollingRef = useRef<(() => void) | null>(null);

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
      // 現在の解析を停止
      if (stopPollingRef.current) {
        stopPollingRef.current();
        stopPollingRef.current = null;
      }

      console.log("🔍 [ANALYSIS] Starting analysis for SFEN:", currentSfen);

      // 解析開始
      const sessionId = await startAnalysisFromSfen(currentSfen);

      dispatch({
        type: "start_analysis",
        payload: { sessionId, position: currentSfen },
      });

      // ポーリング開始
      const stopPolling = await pollAnalysisResult(
        sessionId,
        (result: AnalysisResult) => {
          console.log("📊 [ANALYSIS] Result:", result);
          dispatch({ type: "update_result", payload: result });
        },
        1000, // 1秒間隔
      );

      stopPollingRef.current = stopPolling;
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

      // ポーリング停止
      if (stopPollingRef.current) {
        stopPollingRef.current();
        stopPollingRef.current = null;
      }

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

    // ポーリング停止
    if (stopPollingRef.current) {
      stopPollingRef.current();
      stopPollingRef.current = null;
    }
  }, []);

  // ✅ エラークリア
  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  // ✅ クリーンアップ
  React.useEffect(() => {
    return () => {
      if (stopPollingRef.current) {
        stopPollingRef.current();
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      state,
      startInfiniteAnalysis,
      stopAnalysis: stopAnalysisFunc,
      clearResults,
      clearError,
    }),
    [state, startInfiniteAnalysis, stopAnalysisFunc, clearResults, clearError],
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
