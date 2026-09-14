export { EngineProvider } from "./model/provider";
export { useEngine } from "./model/useEngine";

// **解析と対局が同じ `setoption` を送るための1箇所。** 対局は自分で並べて渡すので、
// ここを通さないと同じ規則が2箇所に生える
export { usiOptionsOf } from "./lib/setup";

export type {
  EngineRuntimeConfig,
  EnginePhase,
  EngineNotReadyReason,
  EngineReadiness,
} from "./model/types";
export type {
  EngineInfo,
  EngineSettings,
  AnalysisResult,
  AnalysisStatus,
  AnalysisCandidate,
  Evaluation,
  EvaluationKind,
} from "./api/rust-types";
