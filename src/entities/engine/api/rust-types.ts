export interface Duration {
  secs: number;
  nanos: number;
}

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

export interface AnalysisConfig {
  time_limit?: Duration;
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

export type EvaluationKind = "Centipawn" | { MateInMoves: number } | { MateUnknown: boolean };

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

export interface AnalysisResult {
  candidates: AnalysisCandidate[];
  mate_sequence?: string[] | null;
}

/**
 * 深度指定の解析が返すもの。
 *
 * **`reached` を見ること。** `go depth` は送っていない（`usi` crate に
 * 深度を載せる手段が無い）ので、Rust 側は `info depth` を見て `stop` を撃つ。
 * 時間の打ち切りが先に来れば、目標に届かないまま結果が返る。
 * `result` だけを読むと、深度22の結果を深度40の解析として画面に出すことになる。
 */
export interface DepthOutcome {
  result: AnalysisResult;
  /** 要求した深度 */
  requested: number;
  /** 実際に届いた深度。`info` が1行も来なければ `null` */
  deepest?: number | null;
  /** `requested` に届いたか */
  reached: boolean;
}

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

export interface EngineStatus {
  isInitialized: boolean;
  engineInfo: EngineInfo | null;
  currentSettings: EngineSettings | null;
  analysisStatus: AnalysisStatus[];
}
