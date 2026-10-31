import { sortByRank } from "../lib/candidates";
import type { AnalysisAction, AnalysisState } from "./types";

export const initialState: AnalysisState = {
  isAnalyzing: false,
  analyzedSfen: null,
  finished: false,
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
        finished: false,
        error: null,
      };

    case "stop_analysis":
      return {
        ...state,
        isAnalyzing: false,
        finished: false,
      };

    // **最後の結果をここで一緒に書く。** 門を `state` の1か所にするため。結果だけを
    // `update_result` で先に出す形だと、開始の直後は `analyzingRef` がまだ倒れたままで
    // 結果が捨てられ、`検討完了` なのに候補手が空になる
    case "finish_analysis":
      if (!state.isAnalyzing) return state;
      return {
        ...state,
        finished: true,
        candidates: sortByRank(action.payload.candidates ?? []),
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
      return { ...state, error: action.payload, isAnalyzing: false, finished: false };

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
