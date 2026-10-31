export { AnalysisProvider } from "./model/provider";
export { useAnalysis } from "./model/useAnalysis";
export { refusalNeedsRestart } from "./model/refusals";

export type { AnalysisState, PositionSyncAdapter } from "./model/types";

// **載せるのは、スライスの外に呼び手が居るものだけ。** 呼び手0の口を載せると、
// 次に触る人が「その口が正しい入口だ」と読む。`sortByRank` は `reducer` が
// `update_result` で必ず通す唯一の並べ替え地点なので、外から呼ばせない。
export { pickTopCandidate } from "./lib/candidates";

// 操作列の語。**エンジンと検討の2つのスライスを読むので、下にある方のここへ置く**
export { engineStatusOf } from "./lib/engineStatus";
export type { EngineStatus } from "./lib/engineStatus";

// 候補手の見せ方。**解析ビューと設定の両方が読む**ので、どちらからも届く位置に置く
export { ANALYSIS_DISPLAY_MODES, resolveAnalysisDisplayMode } from "./model/displayMode";
export type { AnalysisDisplayMode } from "./model/displayMode";
