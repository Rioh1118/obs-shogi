export { AnalysisProvider } from "./model/provider";
export { useAnalysis } from "./model/useAnalysis";

export type {
  AnalysisState,
  AnalysisAction,
  AnalysisContextType,
  PositionSyncAdapter,
} from "./model/types";

// **載せるのは、スライスの外に呼び手が居るものだけ。** 呼び手0の口を載せると、
// 次に触る人が「その口が正しい入口だ」と読む。`sortByRank` は `reducer` が
// `update_result` で必ず通す唯一の並べ替え地点なので、外から呼ばせない。
export { pickTopCandidate } from "./lib/candidates";
