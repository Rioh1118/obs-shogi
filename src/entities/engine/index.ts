export { EngineProvider } from "./model/provider";
export { useEngine } from "./model/useEngine";

export type {
  EngineRuntimeConfig,
  EnginePhase,
  EngineNotReadyReason,
  TerminalNotReadyReason,
  EngineReadiness,
} from "./model/types";
export { isRecoverableNotReady } from "./lib/notReadyReason";
export type {
  EngineInfo,
  EngineSettings,
  AnalysisResult,
  AnalysisStatus,
  AnalysisCandidate,
  Evaluation,
  EvaluationKind,
} from "./api/rust-types";
