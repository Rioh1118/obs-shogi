import { sortByRank } from "../lib/candidates";
import type { AnalysisAction, AnalysisState } from "./types";

export const initialState: AnalysisState = {
  isAnalyzing: false,
  currentPosition: null,
  candidates: [],
  error: null,
};

export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    // **`error` を消す口はここと `clear_results` の2つだけ。**
    // 「消すだけ」の action は読み手も dispatch 元も居なくなったので置かない。
    case "start_analysis":
      return {
        ...state,
        isAnalyzing: true,
        currentPosition: action.payload.position,
        error: null,
      };

    case "stop_analysis":
      return {
        ...state,
        isAnalyzing: false,
      };

    case "update_result": {
      const result = action.payload;
      const candidates = sortByRank(result.candidates ?? []);

      return {
        ...state,
        candidates,
      };
    }

    case "set_error":
      return { ...state, error: action.payload, isAnalyzing: false };

    case "clear_results":
      return {
        ...state,
        candidates: [],
        error: null,
      };

    default:
      return state;
  }
}
