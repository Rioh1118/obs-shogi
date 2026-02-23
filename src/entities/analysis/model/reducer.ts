import { sortByRank } from "../lib/candidates";
import type { AnalysisAction, AnalysisState } from "./types";

export const initialState: AnalysisState = {
  isAnalyzing: false,
  sessionId: null,
  currentPosition: null,
  analysisResults: [],
  candidates: [],
  error: null,
};

export function analysisReducer(
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
