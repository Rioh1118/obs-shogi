export { EngineProvider } from "./model/provider";
export { useEngine } from "./model/useEngine";
export { asStartFailure } from "./lib/engineFailure";
export { ENGINE_START_FAILURE_NOTICES, engineFailureNoticeOf } from "./lib/engineNotices";
export type { EngineFailureNotice } from "./lib/engineNotices";

export type {
  EngineRuntimeConfig,
  EnginePhase,
  EngineNotReadyReason,
  EngineReadiness,
} from "./model/types";
export type { EngineStartFailure, EngineStartFailureKind } from "./lib/engineFailure";
export type {
  StartWarning,
  UsiOptionDef,
  ProbeOutcome,
  AnalysisResult,
  AnalysisCandidate,
  Evaluation,
  EvaluationKind,
  UnresponsiveReason,
} from "./api/rust-types";
