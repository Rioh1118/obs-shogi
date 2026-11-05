export { EngineProvider } from "./model/provider";
export { useEngine } from "./model/useEngine";
export { asStartFailure } from "./lib/engineFailure";
// 申告だけを取る。読み手はプリセット編集（`features/settings`）
export { probeEngine } from "./api/tauri";
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
  SetOptionValue,
  AnalysisCandidate,
  Evaluation,
  UnresponsiveReason,
} from "./api/rust-types";
