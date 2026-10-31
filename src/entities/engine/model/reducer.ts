import type { EngineAction, EngineState } from "./types";

export const initialState: EngineState = {
  phase: "idle",
  engineInfo: null,
  error: null,
  unresponsiveReason: null,

  activeRuntime: null,
  startWarnings: [],
};

export function reducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "initialize_start":
      return { ...state, phase: "initializing", error: null, unresponsiveReason: null };
    case "initialize_success": {
      return {
        ...state,
        phase: "ready",
        engineInfo: action.payload.engineInfo,
        activeRuntime: action.payload.activeRuntime,
        startWarnings: action.payload.warnings,
        error: null,
      };
    }

    case "initialize_error":
      return {
        ...state,
        phase: "error",
        engineInfo: null,
        activeRuntime: null,
        startWarnings: [],
        error: action.payload,
        unresponsiveReason: null,
      };

    // 起動済みの段だけで効く。他の段に居るなら、そのプロセスはもう見ていない
    case "engine_exited":
      if (state.phase !== "ready" && state.phase !== "unresponsive") return state;
      return {
        ...state,
        phase: "exited",
        engineInfo: null,
        activeRuntime: null,
        startWarnings: [],
        unresponsiveReason: null,
      };

    case "engine_unresponsive":
      if (state.phase !== "ready") return state;
      return { ...state, phase: "unresponsive", unresponsiveReason: action.payload };

    case "engine_answered":
      if (state.phase !== "unresponsive") return state;
      return { ...state, phase: "ready", unresponsiveReason: null };

    case "shutdown": {
      return {
        ...state,
        phase: "idle",
        engineInfo: null,
        activeRuntime: null,
        startWarnings: [],
        error: null,
        unresponsiveReason: null,
      };
    }

    case "clear_error": {
      return { ...state, phase: "idle", error: null };
    }

    default:
      return state;
  }
}
