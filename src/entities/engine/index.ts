export { EngineProvider } from "./model/provider";
export { useEngine } from "./model/useEngine";

// **`usiOptionsOf` は載せていない。** 外から読んでいたのは対局を始める面だけで、
// その面は外してある（`docs/spec/features/game-play.md`）。合成そのものは
// `lib/setup.ts` に残してある —— 面を戻すときに、呼び出し元と一緒に載せ直すこと

export type {
  EngineRuntimeConfig,
  EnginePhase,
  EngineNotReadyReason,
  EngineReadiness,
} from "./model/types";
export type { EngineStartFailure, EngineStartFailureKind } from "./lib/engineFailure";
export type {
  EngineInfo,
  AnalysisResult,
  AnalysisStatus,
  AnalysisCandidate,
  Evaluation,
  EvaluationKind,
} from "./api/rust-types";
