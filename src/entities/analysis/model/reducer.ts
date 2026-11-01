import { sortByRank } from "../lib/candidates";
import type { AnalysisAction, AnalysisState } from "./types";

export const initialState: AnalysisState = {
  isAnalyzing: false,
  analyzedSfen: null,
  finished: false,
  stopping: false,
  starting: false,
  candidates: [],
  error: null,
};

/**
 * **`error` を消すのは、開始の action（`start_analysis` / `hold_intent` / `begin_start`）と
 * `clear_results` と `engine_restored` だけ。**
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
        stopping: false,
        starting: false,
        error: null,
      };

    // 読む局面を空ける。残すと、同じ局面で押し直した回に「読み終えた局面」と読んで始まらない
    case "hold_intent":
      return { ...state, isAnalyzing: true, analyzedSfen: null, finished: false, error: null };

    case "begin_start":
      // 断りを空ける。**同じ文で断られても帯が出直す**ため
      return { ...state, starting: true, error: null };

    case "end_start":
      return { ...state, starting: false };

    case "begin_stop":
      return state.isAnalyzing || state.starting ? { ...state, stopping: true } : state;

    // エンジンが戻ったら、エンジンの不調についての断りはもう当たらない
    case "engine_restored":
      return { ...state, error: null };

    case "stop_analysis":
      return {
        ...state,
        isAnalyzing: false,
        finished: false,
        stopping: false,
      };

    // **最後の結果をここで一緒に書く。** 判定を `state` の1か所にするため。結果だけを
    // `update_result` で先に出す形だと、開始の直後は `analyzingRef` がまだ倒れたままで
    // 結果が捨てられ、`検討完了` なのに候補手が空になる
    case "finish_analysis":
      if (!state.isAnalyzing) return state;
      return {
        ...state,
        finished: true,
        candidates: sortByRank(action.payload.candidates ?? []),
      };

    case "update_result":
      return { ...state, candidates: sortByRank(action.payload.candidates ?? []) };

    case "set_error":
      return {
        ...state,
        error: action.payload,
        isAnalyzing: false,
        finished: false,
        stopping: false,
      };

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
