import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
} from "react";
import { engineInitializer } from "@/services/engine/EngineInitializer";
import type { EngineInfo } from "@/commands/engine/types";

// 状態をシンプルに
interface EngineState {
  engineInfo: EngineInfo | null;
  isReady: boolean;
  isInitializing: boolean;
  error: string | null;
}

type EngineAction =
  | { type: "initialize_start" }
  | { type: "initialize_success"; payload: EngineInfo }
  | { type: "initialize_error"; payload: string }
  | { type: "shutdown" }
  | { type: "clear_error" };

const initialState: EngineState = {
  engineInfo: null,
  isReady: false,
  isInitializing: false,
  error: null,
};

function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "initialize_start":
      return { ...state, isInitializing: true, error: null };
    case "initialize_success":
      return {
        ...state,
        engineInfo: action.payload,
        isReady: true,
        isInitializing: false,
        error: null,
      };
    case "initialize_error":
      return {
        ...state,
        engineInfo: null,
        isReady: false,
        isInitializing: false,
        error: action.payload,
      };
    case "shutdown":
      return initialState;
    case "clear_error":
      return { ...state, error: null };
    default:
      return state;
  }
}

interface EngineContextType {
  state: EngineState;
  initialize: () => Promise<void>;
  shutdown: () => Promise<void>;
  clearError: () => void;
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

  // ✅ シンプルな初期化
  const initialize = useCallback(async () => {
    if (state.isInitializing || state.isReady) {
      console.log("⚠️ [ENGINE] Initialize already in progress or completed");
      return;
    }

    dispatch({ type: "initialize_start" });

    try {
      const engineInfo = await engineInitializer.initialize();
      dispatch({ type: "initialize_success", payload: engineInfo });
    } catch (error) {
      const errorMessage = `Engine initialization failed: ${error}`;
      dispatch({ type: "initialize_error", payload: errorMessage });
      throw error;
    }
  }, []);

  // ✅ シンプルなシャットダウン
  const shutdown = useCallback(async () => {
    if (!state.isReady) {
      console.log("⚠️ [ENGINE] Engine not ready, skipping shutdown");
      return;
    }

    try {
      await engineInitializer.shutdown();
      dispatch({ type: "shutdown" });
    } catch (error) {
      console.error("❌ [ENGINE] Shutdown failed:", error);
      // エラーでも状態はリセット
      dispatch({ type: "shutdown" });
      throw error;
    }
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  const value = useMemo(
    () => ({
      state,
      initialize,
      shutdown,
      clearError,
    }),
    [state, initialize, shutdown, clearError],
  );

  return (
    <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
  );
};

export default EngineProvider;
