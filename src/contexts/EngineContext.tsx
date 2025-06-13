import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  setupYaneuraOuEngine,
  startAnalysisFromSfen,
  stopAnalysis,
  shutdownEngine,
  type EngineInfo,
  type AnalysisResult,
} from "@/commands/engine";
import { useGame } from "./GameContext";
import {
  generateUsiPosition,
  getCurrentTurnFromJkf,
  debugJkfState,
} from "@/utils/usi";

import {
  listenToEngineErrors,
  listenToAnalysisUpdates,
  listenToAnalysisComplete,
} from "@/commands/engine/events";
import { type EngineStatus } from "@/commands/engine/types";

// Engine専用の状態管理
interface EngineContextState {
  // エンジン情報
  engineInfo: EngineInfo | null;
  isEngineReady: boolean;
  engineStatus: EngineStatus | null;

  // 解析状態
  isAnalyzing: boolean;
  currentSessionId: string | null;
  analysisResult: AnalysisResult | null;

  // UI状態
  isLoading: boolean;
  error: string | null;

  // 現在解析中の局面情報
  currentPosition: string | null;
  currentTurn: number | null;
}

type EngineAction =
  | { type: "set_engine_info"; payload: EngineInfo | null }
  | { type: "set_engine_ready"; payload: boolean }
  | { type: "set_engine_status"; payload: EngineStatus | null }
  | { type: "set_analyzing"; payload: boolean }
  | { type: "set_session_id"; payload: string | null }
  | { type: "set_analysis_result"; payload: AnalysisResult | null }
  | { type: "set_loading"; payload: boolean }
  | { type: "set_error"; payload: string | null }
  | {
      type: "set_current_position";
      payload: { position: string; turn: number };
    }
  | { type: "clear_error" }
  | { type: "reset_engine" };

const initialState: EngineContextState = {
  engineInfo: null,
  isEngineReady: false,
  engineStatus: null,
  isAnalyzing: false,
  currentSessionId: null,
  analysisResult: null,
  isLoading: false,
  error: null,
  currentPosition: null,
  currentTurn: null,
};

function engineReducer(
  state: EngineContextState,
  action: EngineAction,
): EngineContextState {
  switch (action.type) {
    case "set_engine_info":
      return { ...state, engineInfo: action.payload };
    case "set_engine_ready":
      return { ...state, isEngineReady: action.payload };
    case "set_engine_status":
      return { ...state, engineStatus: action.payload };
    case "set_analyzing":
      return { ...state, isAnalyzing: action.payload };
    case "set_session_id":
      return { ...state, currentSessionId: action.payload };
    case "set_analysis_result":
      return { ...state, analysisResult: action.payload };
    case "set_loading":
      return { ...state, isLoading: action.payload };
    case "set_error":
      return { ...state, error: action.payload };
    case "set_current_position":
      return {
        ...state,
        currentPosition: action.payload.position,
        currentTurn: action.payload.turn,
      };
    case "clear_error":
      return { ...state, error: null };
    case "reset_engine":
      return initialState;
    default:
      return state;
  }
}

interface EngineContextType {
  state: EngineContextState;

  // エンジン操作
  setupEngine: () => Promise<void>;
  shutdownEngineAsync: () => Promise<void>;

  // 解析操作
  startAnalysis: () => Promise<void>;
  stopAnalysisAsync: () => Promise<void>;

  // ユーティリティ
  syncWithGamePosition: () => void;
  clearError: () => void;

  // 状態判定
  canStartAnalysis: () => boolean;
  isPositionChanged: () => boolean;
}

const EngineContext = createContext<EngineContextType | null>(null);

export const useEngine = () => {
  const context = useContext(EngineContext);
  if (!context) {
    throw new Error("useEngine must be used within EngineProvider");
  }
  return context;
};

interface EngineProviderProps {
  children: React.ReactNode;
}

export const EngineProvider: React.FC<EngineProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(engineReducer, initialState);
  const { state: gameState } = useGame();
  const cleanupFunctionsRef = useRef<(() => void)[]>([]);
  const lastPositionRef = useRef<string | null>(null);

  // エラーハンドリング
  const handleError = useCallback((operation: string, err: unknown) => {
    const errorMessage = `${operation}: ${err}`;
    console.error("❌ [ENGINE]", errorMessage);
    dispatch({ type: "set_error", payload: errorMessage });
    dispatch({ type: "set_loading", payload: false });
  }, []);

  // GameContextの状態変化を監視して自動的に局面を同期
  const syncWithGamePosition = useCallback(() => {
    if (!gameState.jkfPlayer) {
      const defaultPosition = "position startpos";
      dispatch({
        type: "set_current_position",
        payload: { position: defaultPosition, turn: 0 },
      });
      lastPositionRef.current = defaultPosition;
      return;
    }

    try {
      const position = generateUsiPosition(gameState.jkfPlayer);
      const turn = getCurrentTurnFromJkf(gameState.jkfPlayer);

      // デバッグ情報を出力
      debugJkfState(gameState.jkfPlayer);

      dispatch({ type: "set_current_position", payload: { position, turn } });

      // 局面が変わった場合の処理
      if (lastPositionRef.current && lastPositionRef.current !== position) {
        console.log("🔄 [ENGINE] Position changed, clearing analysis result");
        dispatch({ type: "set_analysis_result", payload: null });
      }

      lastPositionRef.current = position;
    } catch (err) {
      console.error("Failed to sync with game position:", err);
      handleError("Position sync failed", err);
    }
  }, [gameState.jkfPlayer, handleError]);

  // GameContextの変化を監視
  useEffect(() => {
    syncWithGamePosition();
  }, [syncWithGamePosition]);

  // イベントリスナーのセットアップ
  const setupEventListeners = useCallback(async () => {
    try {
      console.log("🎧 [ENGINE] Setting up event listeners...");

      const removeUpdateListener = await listenToAnalysisUpdates(
        (result: AnalysisResult) => {
          console.log("📊 [ENGINE] Analysis update received:", result);
          dispatch({ type: "set_analysis_result", payload: result });
        },
      );

      const removeCompleteListener = await listenToAnalysisComplete(
        (sessionId: string, result: AnalysisResult) => {
          console.log("✅ [ENGINE] Analysis completed:", sessionId, result);
          dispatch({ type: "set_analysis_result", payload: result });
          dispatch({ type: "set_analyzing", payload: false });
          dispatch({ type: "set_session_id", payload: null });
        },
      );

      const removeErrorListener = await listenToEngineErrors(
        (error: string) => {
          console.log("❌ [ENGINE] Error received:", error);
          handleError("Engine error", error);
          dispatch({ type: "set_analyzing", payload: false });
          dispatch({ type: "set_session_id", payload: null });

          if (
            error.includes("CommunicationFailed") ||
            error.includes("IO error")
          ) {
            dispatch({ type: "set_engine_ready", payload: false });
          }
        },
      );

      cleanupFunctionsRef.current = [
        removeUpdateListener,
        removeCompleteListener,
        removeErrorListener,
      ];

      console.log("✅ [ENGINE] Event listeners setup complete");
    } catch (err) {
      handleError("Event listener setup failed", err);
    }
  }, [handleError]);

  // エンジン初期化
  const setupEngine = useCallback(async () => {
    dispatch({ type: "set_loading", payload: true });
    dispatch({ type: "clear_error" });

    try {
      console.log("🔍 [ENGINE] Setting up engine...");

      // 既存のエンジンをクリーンアップ
      if (state.isEngineReady) {
        await shutdownEngine();
      }

      // クリーンアップ
      cleanupFunctionsRef.current.forEach((cleanup) => cleanup());
      cleanupFunctionsRef.current = [];

      const engineInfo = await setupYaneuraOuEngine();

      if (engineInfo) {
        dispatch({ type: "set_engine_info", payload: engineInfo });
        dispatch({ type: "set_engine_ready", payload: true });
        console.log("✅ [ENGINE] Engine ready:", engineInfo.name);

        await setupEventListeners();
      } else {
        throw new Error("Failed to get engine info");
      }
    } catch (err) {
      handleError("Engine setup failed", err);
      dispatch({ type: "set_engine_ready", payload: false });
    } finally {
      dispatch({ type: "set_loading", payload: false });
    }
  }, [state.isEngineReady, setupEventListeners, handleError]);

  // エンジン終了
  const shutdownEngineAsync = useCallback(async () => {
    try {
      if (state.isAnalyzing) {
        await stopAnalysis();
      }

      cleanupFunctionsRef.current.forEach((cleanup) => cleanup());
      cleanupFunctionsRef.current = [];

      await shutdownEngine();
      dispatch({ type: "reset_engine" });

      console.log("🔌 [ENGINE] Engine shutdown completed");
    } catch (err) {
      handleError("Engine shutdown failed", err);
    }
  }, [state.isAnalyzing, handleError]);

  // 解析開始
  const startAnalysis = useCallback(async () => {
    if (!state.isEngineReady) {
      handleError("Analysis start failed", "Engine is not ready");
      return;
    }

    if (!state.currentPosition) {
      handleError("Analysis start failed", "No position set");
      return;
    }

    if (state.isAnalyzing) {
      console.log(
        "⚠️ [ENGINE] Analysis already running, stopping current analysis",
      );
      await stopAnalysis();
    }

    dispatch({ type: "set_loading", payload: true });
    dispatch({ type: "clear_error" });

    try {
      console.log(
        "🔍 [ENGINE] Starting analysis for position:",
        state.currentPosition,
      );

      // positionコマンドからSFEN部分を抽出
      const sfen = state.currentPosition.replace(/^position\s+/, "");
      const sessionId = await startAnalysisFromSfen(sfen);

      dispatch({ type: "set_session_id", payload: sessionId });
      dispatch({ type: "set_analyzing", payload: true });
      dispatch({ type: "set_analysis_result", payload: null }); // 前の結果をクリア

      console.log("✅ [ENGINE] Analysis started with session:", sessionId);
    } catch (err) {
      handleError("Analysis start failed", err);
      dispatch({ type: "set_analyzing", payload: false });
      dispatch({ type: "set_session_id", payload: null });
    } finally {
      dispatch({ type: "set_loading", payload: false });
    }
  }, [
    state.isEngineReady,
    state.currentPosition,
    state.isAnalyzing,
    handleError,
  ]);

  // 解析停止
  const stopAnalysisAsync = useCallback(async () => {
    if (!state.isAnalyzing) {
      console.log("⚠️ [ENGINE] No analysis running");
      return;
    }

    try {
      console.log("⏹️ [ENGINE] Stopping analysis...");
      await stopAnalysis();

      dispatch({ type: "set_analyzing", payload: false });
      dispatch({ type: "set_session_id", payload: null });

      console.log("✅ [ENGINE] Analysis stopped");
    } catch (err) {
      handleError("Analysis stop failed", err);
    }
  }, [state.isAnalyzing, handleError]);

  // エラークリア
  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  // 解析開始可能かどうか
  const canStartAnalysis = useCallback(() => {
    return (
      state.isEngineReady &&
      !state.isAnalyzing &&
      !state.isLoading &&
      state.currentPosition !== null
    );
  }, [
    state.isEngineReady,
    state.isAnalyzing,
    state.isLoading,
    state.currentPosition,
  ]);

  // 局面が変わったかどうか
  const isPositionChanged = useCallback(() => {
    return lastPositionRef.current !== state.currentPosition;
  }, [state.currentPosition]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      cleanupFunctionsRef.current.forEach((cleanup) => cleanup());
    };
  }, []);

  const value: EngineContextType = {
    state,
    setupEngine,
    shutdownEngineAsync,
    startAnalysis,
    stopAnalysisAsync,
    syncWithGamePosition,
    clearError,
    canStartAnalysis,
    isPositionChanged,
  };

  return (
    <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
  );
};

export default EngineProvider;
