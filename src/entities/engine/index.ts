export { EngineProvider } from "./model/provider";
export { useEngine } from "./model/useEngine";

// **`valuesOf` は載せていない。** 利用者の値を送る形にするだけで、外から使う口が無い。
// 評価関数・定跡をどの USI の名前で送るかは Rust が決める（`binding.rs`）

export type {
  EngineRuntimeConfig,
  EnginePhase,
  EngineNotReadyReason,
  EngineReadiness,
} from "./model/types";
export type { EngineStartFailure, EngineStartFailureKind } from "./lib/engineFailure";
export type {
  StartWarning,
  EngineInfo,
  AnalysisResult,
  AnalysisStatus,
  AnalysisCandidate,
  Evaluation,
  EvaluationKind,
} from "./api/rust-types";
