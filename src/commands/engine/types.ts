export interface Duration {
  secs: number;
  nanos: number;
}

// ===== エンジン情報関連 =====
export interface EngineInfo {
  name: string;
  author: string;
  options: EngineOption[];
}

export interface EngineOption {
  name: string;
  option_type: EngineOptionType;
  default_value?: string;
  current_value?: string;
}

export interface EngineOptionType {
  Check?: { default?: boolean };
  Spin?: { default?: number; min?: number; max?: number };
  Combo?: { default?: string; vars: string[] };
  Button?: { default?: string };
  String?: { default?: string };
  Filename?: { default?: string };
}

export interface EngineSettings {
  options: Record<string, string>;
}

// ===== 解析設定関連 =====
export interface AnalysisConfig {
  time_limit?: { secs: number; nanos: number };
  depth_limit?: number;
  node_limit?: number;
  mate_search: boolean;
  multi_pv?: number;
}

export interface AnalysisStatus {
  is_analyzing: boolean;
  session_id?: string | null;
  elapsed_time?: Duration | null;
  config?: AnalysisConfig | null;
  analysis_count: number;
}

export type EvaluationKind =
  | "Centipawn"
  | { MateInMoves: number }
  | { MateUnknown: boolean };

export interface Evaluation {
  value: number;
  kind: EvaluationKind;
}

export interface AnalysisCandidate {
  rank: number;
  first_move?: string | null;
  pv_line: string[];
  evaluation?: Evaluation | null;
  depth?: number | null;
  nodes?: number | null;
  time_ms?: number | null;
}

// ===== 解析結果関連 =====
export interface AnalysisResult {
  candidates: AnalysisCandidate[];
  mate_sequence?: string[] | null;
}

export interface AnalysisResult {
  candidates: AnalysisCandidate[];
  mate_sequence?: string[] | null;
}

// ===== イベント関連 =====
export interface AnalysisUpdateEvent {
  sessionId: string;
  result: AnalysisResult;
  timestamp: number;
}

export interface AnalysisCompleteEvent {
  sessionId: string;
  finalResult: AnalysisResult;
  totalTime: number;
}

// ===== バッチ処理関連 =====
export interface BatchAnalysisPosition {
  moves: string[];
  name?: string;
}

export interface BatchAnalysisConfig {
  timeSeconds?: number;
  depth?: number;
}

export interface BatchAnalysisResult {
  position: string;
  name?: string;
  result: AnalysisResult;
}

// ===== エンジン状態関連 =====
export interface EngineStatus {
  isInitialized: boolean;
  engineInfo: EngineInfo | null;
  currentSettings: EngineSettings | null;
  analysisStatus: AnalysisStatus[];
}
