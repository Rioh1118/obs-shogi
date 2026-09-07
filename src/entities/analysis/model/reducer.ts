import { sortByRank } from "../lib/candidates";
import type { AnalysisAction, AnalysisState } from "./types";

export const initialState: AnalysisState = {
  isAnalyzing: false,
  analyzedSfen: null,
  candidates: [],
  error: null,
};

/**
 * **`error` を消すのは `start_analysis` と `clear_results` だけ。**
 * 「消すだけ」の action は置かない——消える条件が action の名前から読めなくなる。
 */
export function analysisReducer(state: AnalysisState, action: AnalysisAction): AnalysisState {
  switch (action.type) {
    case "start_analysis":
      return {
        ...state,
        isAnalyzing: true,
        analyzedSfen: action.payload.sfen,
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
