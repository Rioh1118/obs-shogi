import type { ConfigAction, ConfigState } from "./types";

export const initialState: ConfigState = {
  config: null,
  isLoading: true,
  error: null,
};

export function configReducer(
  state: ConfigState,
  action: ConfigAction,
): ConfigState {
  switch (action.type) {
    case "loading":
      return { ...state, isLoading: true, error: null };
    case "loaded":
    case "updated":
      return { config: action.payload, isLoading: false, error: null };
    case "error":
      return { ...state, isLoading: false, error: action.payload };
    default:
      throw new Error("Unknown action type");
  }
}
