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

// ===== 解析結果関連 =====
export interface AnalysisResult {
  evaluation?: Evaluation;
  principal_variations: PrincipalVariation[];
  depth_info?: DepthInfo;
  search_stats?: SearchStats;
}

export interface Evaluation {
  value: number;
  kind: EvaluationKind;
}

export type EvaluationKind =
  | "Centipawn"
  | { MateInMoves: number }
  | { MateUnknown: boolean };

export interface PrincipalVariation {
  line_number?: number;
  moves: string[];
  evaluation?: Evaluation;
}

export interface DepthInfo {
  depth: number;
  selective_depth?: number;
}

export interface SearchStats {
  nodes?: number;
  nps?: number;
  hash_full?: number;
  time_elapsed?: { secs: number; nanos: number };
}

export interface AnalysisStatus {
  is_analyzing: boolean;
  session_id?: string;
  elapsed_time?: { secs: number; nanos: number };
  config?: AnalysisConfig;
  analysis_count: number;
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
