import type { EngineAction, EngineState } from "./types";

export const initialState: EngineState = {
  phase: "idle",
  engineInfo: null,
  error: null,

  activeRuntime: null,
};

export function reducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case "initialize_start":
      return { ...state, phase: "initializing", error: null };
    case "initialize_success": {
      return {
        ...state,
        phase: "ready",
        engineInfo: action.payload.engineInfo,
        activeRuntime: action.payload.activeRuntime,
        error: null,
      };
    }

    case "initialize_error":
      return {
        ...state,
        phase: "error",
        engineInfo: null,
        activeRuntime: null,
        error: action.payload,
      };

    case "shutdown": {
      return {
        ...state,
        phase: "idle",
        engineInfo: null,
        activeRuntime: null,
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
