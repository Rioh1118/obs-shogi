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

/** `setoption` 1件（Rust の `SetOptionValue`）。**並べた順に送られる** */
export interface SetOptionValue {
  name: string;
  value: string;
}

/** 解析の起動で選んだ定跡（Rust の `BookChoice`）。`path` は絶対パス */
export interface BookChoice {
  path: string;
  useInAnalysis: boolean;
}

/**
 * 起動で送らなかった・変えて送った設定（Rust の `StartWarning`）。**起動はできている。**
 * 画面の文言は種類から組む（`app/providers/bridges/startWarningNotice.ts`）
 */
export type StartWarning =
  | { kind: "notDeclared"; name: string }
  | { kind: "overriddenByBinding"; name: string }
  | { kind: "clamped"; name: string; value: string }
  | { kind: "notInVars"; name: string; value: string }
  | { kind: "evalNotSupported" }
  | { kind: "evalNotChosen"; name: string }
  | { kind: "evalNeedsFile"; name: string }
  | { kind: "bookNotSupported" }
  | { kind: "bookNameNotInVars"; file: string }
  | { kind: "bookCannotBeDisabled" }
  | { kind: "invalidType"; name: string; value: string };

/**
 * プリセットに**保存する**オプションの定義1件（Rust の `UsiOptionDef`）。画面に欄を出すためだけに使い、
 * 送るときは起動のたびの申告を見る。**ファイルに残る形なので、変えるときはプリセットの版を上げる**
 */
export type UsiOptionDef =
  | { name: string; type: "check"; default: boolean | null }
  | { name: string; type: "spin"; default: number | null; min: number | null; max: number | null }
  | { name: string; type: "combo"; default: string | null; vars: string[] }
  | { name: string; type: "string"; default: string | null }
  | { name: string; type: "filename"; default: string | null }
  | { name: string; type: "button" };

/** エンジンの申告を取った結果（Rust の `ProbeOutcome`） */
export interface ProbeOutcome {
  /** 受けた番号をそのまま返す。いまの取得でなければ捨てる */
  token: number;
  /** 受けたパスをそのまま返す */
  enginePath: string;
  name: string;
  author: string;
  /** 申告の順 */
  definitions: UsiOptionDef[];
  /** 評価関数・定跡・固定値が持つ名前。利用者の値としては送らない（欄は読み取り専用） */
  reserved: string[];
}

/** 解析の起動が返すもの（Rust の `StartOutcome`） */
export interface StartOutcome {
  info: EngineInfo;
  warnings: StartWarning[];
}

/**
 * エンジンを起動できなかった理由の種類（Rust の `StartFailureKind`）。
 * 利用者が取れる行動で分けてある。画面の文言はこれから組む
 */
export type StartFailureKind =
  | "spawnFailed"
  | "quarantined"
  | "notUsi"
  | "exitedEarly"
  | "timedOut"
  | "invalidValue"
  | "cancelled"
  | "other";

/** `start_analysis_engine` が断ったときの値（Rust の `StartFailure`）。`message` はエンジンの出力を含みうる */
export interface StartFailure {
  kind: StartFailureKind;
  message: string;
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
