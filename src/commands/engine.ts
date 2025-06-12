import { invoke } from "@tauri-apps/api/core";

export const ENGINE_CONSTANTS = {
  ENGINE_PATH:
    "/Users/riohatta/test_shogi_engine/li/YaneuraOu_NNUE_halfKP1024X2_8_32-V830Git_APPLEM1",
  WORK_DIR: "/Users/riohatta/test_shogi_engine/li",
  EVAL_DIR: "/Users/riohatta/test_shogi_engine/li/eval",
  BOOK_DIR: "/Users/riohatta/test_shogi_engine/li/book/",
} as const;

// ===== 型定義 =====
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

// ===== リクエスト・レスポンス型 =====
export interface InitializeEngineResponse {
  engine_info: EngineInfo;
  success: boolean;
}

export interface AnalysisStatus {
  is_analyzing: boolean;
  message?: string;
}

// ===== エンジン初期化・設定関連 =====

/**
 * エンジンを初期化してオプション情報を取得
 */
export async function initializeEngine(
  enginePath?: string,
  workDir?: string,
): Promise<InitializeEngineResponse> {
  return await invoke("initialize_engine_with_options", {
    enginePath: enginePath || ENGINE_CONSTANTS.ENGINE_PATH,
    workDir: workDir || ENGINE_CONSTANTS.WORK_DIR,
  });
}

/**
 * YaneuraOuエンジンを推奨設定で初期化
 */
export async function initializeYaneuraOuEngine(): Promise<InitializeEngineResponse> {
  return await initializeEngine(
    ENGINE_CONSTANTS.ENGINE_PATH,
    ENGINE_CONSTANTS.WORK_DIR,
  );
}

/**
 * エンジン設定を適用
 */
export async function applyEngineSettings(
  settings: EngineSettings,
): Promise<void> {
  return await invoke("apply_engine_settings", { settings });
}

/**
 * YaneuraOu用の推奨設定を適用
 */
export async function applyYaneuraOuRecommendedSettings(): Promise<void> {
  const settings: EngineSettings = {
    options: {
      USI_Hash: "1024", // ハッシュサイズ 1GB
      Threads: "4", // スレッド数
      MultiPV: "1", // 候補手数
      NetworkDelay: "120", // ネットワーク遅延
      NetworkDelay2: "1120", // ネットワーク遅延2
      MinimumThinkingTime: "2000", // 最小思考時間
      SlowMover: "100", // 時間配分
      BookFile: "user_book1.db", // 定跡ファイル
      EvalDir: "eval", // 評価関数ディレクトリ
    },
  };
  return await applyEngineSettings(settings);
}

/**
 * カスタム設定を適用
 */
export async function applyCustomSettings(
  hashSizeMB: number = 1024,
  threads: number = 4,
  multiPV: number = 1,
): Promise<void> {
  const settings: EngineSettings = {
    options: {
      USI_Hash: hashSizeMB.toString(),
      Threads: threads.toString(),
      MultiPV: multiPV.toString(),
    },
  };
  return await applyEngineSettings(settings);
}

/**
 * エンジンの準備状態を確認
 */
export async function getEngineReadyStatus(): Promise<boolean> {
  return await invoke("get_engine_ready_status");
}

// ===== 解析関連 =====

/**
 * 無制限解析を開始
 */
export async function startInfiniteAnalysis(position: string): Promise<void> {
  return await invoke("start_infinite_analysis", { position });
}

/**
 * 初期局面から指定した手順での解析を開始
 */
export async function startAnalysisFromMoves(moves: string[]): Promise<void> {
  const position =
    moves.length > 0 ? `startpos moves ${moves.join(" ")}` : "startpos";
  return await startInfiniteAnalysis(position);
}

/**
 * SFEN形式の局面から解析を開始
 */
export async function startAnalysisFromSfen(sfen: string): Promise<void> {
  const position = `sfen ${sfen}`;
  return await startInfiniteAnalysis(position);
}

/**
 * 解析を停止
 */
export async function stopAnalysis(): Promise<void> {
  return await invoke("stop_analysis");
}

/**
 * 解析状態を取得
 */
export async function getAnalysisStatus(): Promise<AnalysisStatus> {
  return await invoke("get_analysis_status");
}

// ===== 解析結果取得 =====

/**
 * 最新の解析結果を取得（1つ）
 */
export async function getLatestAnalysisResult(): Promise<AnalysisResult | null> {
  return await invoke("get_latest_analysis_result");
}

/**
 * 溜まっている全ての解析結果を取得
 */
export async function getAllPendingAnalysisResults(): Promise<
  AnalysisResult[]
> {
  return await invoke("get_all_pending_analysis_results");
}

// ===== エンジン管理 =====

/**
 * エンジンを終了
 */
export async function shutdownEngine(): Promise<void> {
  return await invoke("shutdown_engine");
}

// ===== ユーティリティ関数 =====

/**
 * 評価値を人間が読みやすい形式に変換
 */
export function formatEvaluation(evaluation: Evaluation): string {
  switch (evaluation.kind) {
    case "Centipawn":
      return `${evaluation.value > 0 ? "+" : ""}${evaluation.value}`;
    default:
      if (typeof evaluation.kind === "object") {
        if ("MateInMoves" in evaluation.kind) {
          const moves = evaluation.kind.MateInMoves;
          return moves > 0 ? `+詰${moves}` : `-詰${Math.abs(moves)}`;
        }
        if ("MateUnknown" in evaluation.kind) {
          return evaluation.kind.MateUnknown ? "+詰" : "-詰";
        }
      }
      return "?";
  }
}

/**
 * 主要変化を人間が読みやすい形式に変換
 */
export function formatPrincipalVariation(pv: PrincipalVariation): string {
  const moves = pv.moves.join(" ");
  const eval_str = pv.evaluation ? ` (${formatEvaluation(pv.evaluation)})` : "";
  const line_str = pv.line_number ? `[${pv.line_number}] ` : "";
  return `${line_str}${moves}${eval_str}`;
}

/**
 * 解析結果のサマリーを作成
 */
export function createAnalysisSummary(result: AnalysisResult): string {
  const lines: string[] = [];

  if (result.depth_info) {
    lines.push(`深度: ${result.depth_info.depth}`);
  }

  if (result.search_stats?.nodes) {
    lines.push(`ノード数: ${result.search_stats.nodes.toLocaleString()}`);
  }

  if (result.search_stats?.nps) {
    lines.push(`NPS: ${result.search_stats.nps.toLocaleString()}`);
  }

  if (result.evaluation) {
    lines.push(`評価値: ${formatEvaluation(result.evaluation)}`);
  }

  if (result.principal_variations.length > 0) {
    lines.push("主要変化:");
    result.principal_variations.forEach((pv) => {
      lines.push(`  ${formatPrincipalVariation(pv)}`);
    });
  }

  return lines.join("\n");
}

// ===== エンジンセットアップのヘルパー関数 =====

/**
 * エンジンを完全にセットアップ（初期化 + 推奨設定適用）
 */
export async function setupYaneuraOuEngine(): Promise<InitializeEngineResponse> {
  try {
    // 1. エンジン初期化
    const initResult = await initializeYaneuraOuEngine();
    console.log("Engine initialized:", initResult.engine_info.name);

    // 2. 推奨設定適用
    await applyYaneuraOuRecommendedSettings();
    console.log("Recommended settings applied");

    // 3. 準備状態確認
    const isReady = await getEngineReadyStatus();
    console.log("Engine ready:", isReady);

    return initResult;
  } catch (error) {
    console.error("Failed to setup engine:", error);
    throw error;
  }
}

/**
 * 簡単な解析テスト
 */
export async function testAnalysis(): Promise<void> {
  try {
    // 初期局面から数手進めた局面で解析
    const testMoves = ["7g7f", "3c3d", "2g2f"];

    console.log("Starting analysis test...");
    await startAnalysisFromMoves(testMoves);

    // 3秒待って結果を取得
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const results = await getAllPendingAnalysisResults();
    console.log("Analysis results:", results.length);

    if (results.length > 0) {
      const latest = results[results.length - 1];
      console.log("Latest analysis:");
      console.log(createAnalysisSummary(latest));
    }

    await stopAnalysis();
    console.log("Analysis test completed");
  } catch (error) {
    console.error("Analysis test failed:", error);
    throw error;
  }
}

// ===== デフォルトエクスポート =====
export default {
  // 初期化
  initializeEngine,
  initializeYaneuraOuEngine,
  setupYaneuraOuEngine,

  // 設定
  applyEngineSettings,
  applyYaneuraOuRecommendedSettings,
  applyCustomSettings,

  // 解析
  startInfiniteAnalysis,
  startAnalysisFromMoves,
  startAnalysisFromSfen,
  stopAnalysis,
  getAnalysisStatus,

  // 結果取得
  getLatestAnalysisResult,
  getAllPendingAnalysisResults,

  // 管理
  shutdownEngine,

  // ユーティリティ
  formatEvaluation,
  formatPrincipalVariation,
  createAnalysisSummary,
  testAnalysis,

  // 定数
  ENGINE_CONSTANTS,
};
