import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";

import { engineInitializer } from "@/services/engine/EngineInitializer";
import type { EngineInfo } from "@/commands/engine/types";
import type { EnginePhase, EngineRuntimeConfig } from "@/types/engine";

import { useEnginePresets } from "./EnginePresetsContext";
import { equalRuntime } from "@/utils/engineEqualConfig";
import type { PresetId } from "@/types/enginePresets";

type EngineState = {
  phase: EnginePhase;
  engineInfo: EngineInfo | null;
  error: string | null;

  activeRuntime: EngineRuntimeConfig | null;
  activePresetId: PresetId | null;
};

type EngineAction =
  | { type: "initialize_start" }
  | {
      type: "initialize_success";
      payload: {
        engineInfo: EngineInfo;
        activeRuntime: EngineRuntimeConfig;
        activePresetId: PresetId | null;
      };
    }
  | { type: "initialize_error"; payload: string }
  | { type: "shutdown" }
  | { type: "clear_error" };

const initialState: EngineState = {
  phase: "idle",
  engineInfo: null,
  error: null,

  activeRuntime: null,
  activePresetId: null,
};

function engineReducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "initialize_start":
      return { ...state, phase: "initializing", error: null };
    case "initialize_success": {
      return {
        ...state,
        phase: "ready",
        engineInfo: action.payload.engineInfo,
        activeRuntime: action.payload.activeRuntime,
        activePresetId: action.payload.activePresetId,
        error: null,
      };
    }

    case "initialize_error":
      return {
        ...state,
        phase: "error",
        engineInfo: null,
        activeRuntime: null,
        activePresetId: null,
        error: action.payload,
      };

    case "shutdown": {
      return {
        ...state,
        phase: "idle",
        engineInfo: null,
        activeRuntime: null,
        activePresetId: null,
        error: null,
      };
    }

    case "clear_error": {
      return { ...state, phase: "idle", error: null };
    }

    default:
      return state;
  }
}

type EngineContextType = {
  state: EngineState;

  // derived
  isReady: boolean;

  initialize: () => Promise<boolean>;
  shutdown: () => Promise<void>;
  restart: () => Promise<boolean>;
  clearError: () => void;
};

const EngineContext = createContext<EngineContextType | null>(null);

export const EngineProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { runtimeConfig, state: presetsState } = useEnginePresets();
  const selectedPresetId = presetsState.selectedPresetId;
  const [state, dispatch] = useReducer(engineReducer, initialState);
  const seqRef = useRef(0);
  const lastTriedRef = useRef<{
    runtime: EngineRuntimeConfig | null;
    presetId: PresetId | null;
  }>({ runtime: null, presetId: null });

  const isReady =
    state.phase === "ready" &&
    !!state.engineInfo &&
    !!runtimeConfig &&
    !!state.activeRuntime &&
    state.activePresetId === selectedPresetId &&
    equalRuntime(runtimeConfig, state.activeRuntime);

  // lifecycle
  const initialize = useCallback(async (): Promise<boolean> => {
    console.log("initialize");
    if (!runtimeConfig) return false;
    if (state.phase === "initializing") return false;

    const mySeq = ++seqRef.current;

    const snap: EngineRuntimeConfig =
      typeof structuredClone === "function"
        ? structuredClone(runtimeConfig)
        : JSON.parse(JSON.stringify(runtimeConfig));

    lastTriedRef.current = { runtime: snap, presetId: selectedPresetId };
    dispatch({ type: "initialize_start" });

    try {
      const info = await engineInitializer.initialize(runtimeConfig);
      if (seqRef.current !== mySeq) return false;

      dispatch({
        type: "initialize_success",
        payload: {
          engineInfo: info,
          activeRuntime: snap,
          activePresetId: selectedPresetId,
        },
      });

      return true;
    } catch (e) {
      if (seqRef.current !== mySeq) return false;
      dispatch({
        type: "initialize_error",
        payload: `Engine initialization failed: ${String(e)}`,
      });
      return false;
    }
  }, [runtimeConfig, selectedPresetId, state.phase]);

  const shutdown = useCallback(async (): Promise<void> => {
    seqRef.current++;
    try {
      await engineInitializer.shutdown();
    } finally {
      dispatch({ type: "shutdown" });
    }
  }, []);

  const restart = useCallback(async (): Promise<boolean> => {
    await shutdown();
    return await initialize();
  }, [shutdown, initialize]);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, []);

  useEffect(() => {
    // 設定が無い → 起動中なら止める
    if (!runtimeConfig) {
      if (
        state.phase === "ready" ||
        state.phase === "initializing" ||
        state.phase === "error"
      ) {
        shutdown().catch(() => {
          console.log("設定null stop");
        });
      }
      return;
    }

    // error でも「別設定なら」再トライする（同一設定なら止める）
    if (state.phase === "error") {
      const last = lastTriedRef.current;
      const sameRuntime = last.runtime
        ? equalRuntime(runtimeConfig, last.runtime)
        : false;
      const samePreset = last.presetId === selectedPresetId;

      if (!(sameRuntime && samePreset)) {
        initialize().catch(() => {});
      }
      return;
    }

    // idle → 起動
    if (state.phase === "idle") {
      initialize().catch(() => {});
      return;
    }

    // ready で設定が変わった → 再起動
    if (state.phase === "ready" && state.activeRuntime) {
      const runtimeChanged = !equalRuntime(runtimeConfig, state.activeRuntime);
      const presetChanged = state.activePresetId !== selectedPresetId;

      if (runtimeChanged || presetChanged) {
        restart().catch(() => {});
      }
    }
  }, [
    runtimeConfig,
    selectedPresetId,
    state.phase,
    state.activeRuntime,
    state.activePresetId,
    initialize,
    shutdown,
    restart,
  ]);

  const value = useMemo<EngineContextType>(
    () => ({
      state,
      isReady,

      initialize,
      shutdown,
      restart,
      clearError,
    }),
    [state, isReady, initialize, shutdown, restart, clearError],
  );

  return (
    <EngineContext.Provider value={value}>{children}</EngineContext.Provider>
  );
};

export const useEngine = () => {
  const context = useContext(EngineContext);
  if (!context) throw new Error("useEngine must be used within EngineProvider");
  return context;
};

export default EngineProvider;
