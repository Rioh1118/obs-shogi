export { AnalysisProvider } from "./model/provider";
export { useAnalysis } from "./model/useAnalysis";
export { refusalNeedsRestart } from "./model/refusals";

export type { AnalysisState, PositionSyncAdapter } from "./model/types";

// 載せるのはスライスの外に呼び手が居るものだけ。呼び手0の名前を載せると、
// 次に触る人がその名前を正しい入口だと読む。
export { pickTopCandidate } from "./lib/candidates";

// 操作列の語。エンジンと検討の両方を読むので、エンジンより上のこのスライスに置く
export { engineStatusOf } from "./lib/engineStatus";
export type { EngineStatus } from "./lib/engineStatus";

// 候補手の見せ方。解析ビューと設定の両方が読む
export { ANALYSIS_DISPLAY_MODES, resolveAnalysisDisplayMode } from "./model/displayMode";
export type { AnalysisDisplayMode } from "./model/displayMode";
