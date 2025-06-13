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

export interface AnalysisConfig {
  time_limit?: { secs: number; nanos: number };
  depth_limit?: number;
  node_limit?: number;
  mate_search: boolean;
  multi_pv?: number;
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

export interface AnalysisStatus {
  is_analyzing: boolean;
  session_id?: string;
  elapsed_time?: { secs: number; nanos: number };
  config?: AnalysisConfig;
  analysis_count: number;
}

// ===== エンジン初期化・設定関連 =====

/**
 * エンジンを初期化
 */
export async function initializeEngine(
  enginePath?: string,
  workDir?: string,
): Promise<void> {
  return await invoke("initialize_engine", {
    enginePath: enginePath || ENGINE_CONSTANTS.ENGINE_PATH,
    workingDir: workDir || ENGINE_CONSTANTS.WORK_DIR,
  });
}

/**
 * YaneuraOuエンジンを推奨設定で初期化
 */
export async function initializeYaneuraOuEngine(): Promise<void> {
  return await initializeEngine(
    ENGINE_CONSTANTS.ENGINE_PATH,
    ENGINE_CONSTANTS.WORK_DIR,
  );
}

/**
 * エンジン情報を取得
 */
export async function getEngineInfo(): Promise<EngineInfo | null> {
  return await invoke("get_engine_info");
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
 * エンジン設定を取得
 */
export async function getEngineSettings(): Promise<EngineSettings> {
  return await invoke("get_engine_settings");
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

// ===== 局面設定 =====

/**
 * 局面を設定
 */
export async function setPosition(position: string): Promise<void> {
  return await invoke("set_position", { position });
}

/**
 * 初期局面から指定した手順で局面を設定
 */
export async function setPositionFromMoves(moves: string[]): Promise<void> {
  const position =
    moves.length > 0 ? `startpos moves ${moves.join(" ")}` : "startpos";
  return await setPosition(position);
}

/**
 * SFEN形式の局面を設定
 */
export async function setPositionFromSfen(sfen: string): Promise<void> {
  const position = `sfen ${sfen}`;
  return await setPosition(position);
}

// ===== 解析関連 =====

/**
 * 無制限解析を開始
 */
export async function startInfiniteAnalysis(): Promise<string> {
  return await invoke("start_infinite_analysis");
}

/**
 * 時間制限解析を実行
 */
export async function analyzeWithTime(
  timeSeconds: number,
): Promise<AnalysisResult> {
  return await invoke("analyze_with_time", { timeSeconds });
}

/**
 * 深度制限解析を実行
 */
export async function analyzeWithDepth(depth: number): Promise<AnalysisResult> {
  return await invoke("analyze_with_depth", { depth });
}

/**
 * 解析を停止
 */
export async function stopAnalysis(sessionId?: string): Promise<void> {
  return await invoke("stop_analysis", { sessionId });
}

/**
 * 解析状態を取得
 */
export async function getAnalysisStatus(): Promise<AnalysisStatus[]> {
  return await invoke("get_analysis_status");
}

/**
 * 解析結果を取得（セッション指定）
 */
export async function getAnalysisResult(
  sessionId: string,
): Promise<AnalysisResult | null> {
  return await invoke("get_analysis_result", { sessionId });
}

/**
 * 最後の解析結果を取得
 */
export async function getLastResult(): Promise<AnalysisResult | null> {
  return await invoke("get_last_result");
}

// ===== エンジン管理 =====

/**
 * エンジンを終了
 */
export async function shutdownEngine(): Promise<void> {
  return await invoke("shutdown_engine");
}

// ===== 高レベル操作関数 =====

/**
 * 初期局面から指定した手順での解析を開始
 */
export async function startAnalysisFromMoves(moves: string[]): Promise<string> {
  await setPositionFromMoves(moves);
  return await startInfiniteAnalysis();
}

/**
 * SFEN形式の局面から解析を開始
 */
export async function startAnalysisFromSfen(sfen: string): Promise<string> {
  await setPositionFromSfen(sfen);
  return await startInfiniteAnalysis();
}

/**
 * 指定時間での解析（局面設定込み）
 */
export async function analyzePositionWithTime(
  moves: string[],
  timeSeconds: number,
): Promise<AnalysisResult> {
  await setPositionFromMoves(moves);
  return await analyzeWithTime(timeSeconds);
}

/**
 * 指定深度での解析（局面設定込み）
 */
export async function analyzePositionWithDepth(
  moves: string[],
  depth: number,
): Promise<AnalysisResult> {
  await setPositionFromMoves(moves);
  return await analyzeWithDepth(depth);
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
 * 解析設定を人間が読みやすい形式に変換
 */
export function formatAnalysisConfig(config: AnalysisConfig): string {
  const parts: string[] = [];

  if (config.time_limit) {
    const seconds =
      config.time_limit.secs + config.time_limit.nanos / 1_000_000_000;
    parts.push(`時間制限: ${seconds}秒`);
  }

  if (config.depth_limit) {
    parts.push(`深度制限: ${config.depth_limit}手`);
  }

  if (config.node_limit) {
    parts.push(`ノード制限: ${config.node_limit.toLocaleString()}`);
  }

  if (config.multi_pv && config.multi_pv > 1) {
    parts.push(`候補手数: ${config.multi_pv}`);
  }

  parts.push(`詰み探索: ${config.mate_search ? "有効" : "無効"}`);

  return parts.join(", ");
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

/**
 * 解析状態のサマリーを作成
 */
export function createAnalysisStatusSummary(status: AnalysisStatus): string {
  const lines: string[] = [];

  lines.push(`状態: ${status.is_analyzing ? "解析中" : "停止中"}`);

  if (status.session_id) {
    lines.push(`セッションID: ${status.session_id}`);
  }

  if (status.elapsed_time) {
    const seconds =
      status.elapsed_time.secs + status.elapsed_time.nanos / 1_000_000_000;
    lines.push(`経過時間: ${seconds.toFixed(1)}秒`);
  }

  lines.push(`解析回数: ${status.analysis_count}`);

  if (status.config) {
    lines.push(`設定: ${formatAnalysisConfig(status.config)}`);
  }

  return lines.join("\n");
}

// ===== ポーリング機能 =====

/**
 * 解析結果を定期的にポーリング
 */
export async function pollAnalysisResult(
  sessionId: string,
  onResult: (result: AnalysisResult) => void,
  intervalMs: number = 500,
  timeoutMs?: number,
): Promise<() => void> {
  let isPolling = true;
  const startTime = Date.now();

  const poll = async () => {
    while (isPolling) {
      try {
        // タイムアウトチェック
        if (timeoutMs && Date.now() - startTime > timeoutMs) {
          console.log("Polling timeout reached");
          break;
        }

        const result = await getAnalysisResult(sessionId);
        if (result) {
          onResult(result);
        }

        // 解析状態をチェック
        const statuses = await getAnalysisStatus();
        const currentStatus = statuses.find((s) => s.session_id === sessionId);
        if (!currentStatus || !currentStatus.is_analyzing) {
          console.log("Analysis completed or session not found");
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      } catch (error) {
        console.error("Polling error:", error);
        break;
      }
    }
  };

  // 非同期でポーリング開始
  poll();

  // ポーリング停止関数を返す
  return () => {
    isPolling = false;
  };
}

/**
 * 無制限解析を開始してリアルタイムで結果を受信
 */
export async function startInfiniteAnalysisWithPolling(
  moves: string[],
  onResult: (result: AnalysisResult) => void,
  intervalMs: number = 500,
): Promise<{
  sessionId: string;
  stopPolling: () => void;
  stopAnalysis: () => Promise<void>;
}> {
  const sessionId = await startAnalysisFromMoves(moves);
  const stopPolling = await pollAnalysisResult(sessionId, onResult, intervalMs);

  return {
    sessionId,
    stopPolling,
    stopAnalysis: async () => {
      stopPolling();
      await stopAnalysis(sessionId);
    },
  };
}

// ===== バッチ解析機能 =====

/**
 * 複数の局面を順次解析
 */
export async function batchAnalyze(
  positions: { moves: string[]; name?: string }[],
  analysisConfig: { timeSeconds?: number; depth?: number } = {},
  onProgress?: (current: number, total: number, result: AnalysisResult) => void,
): Promise<{ position: string; name?: string; result: AnalysisResult }[]> {
  const results: { position: string; name?: string; result: AnalysisResult }[] =
    [];

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];

    try {
      let result: AnalysisResult;

      if (analysisConfig.timeSeconds) {
        result = await analyzePositionWithTime(
          position.moves,
          analysisConfig.timeSeconds,
        );
      } else if (analysisConfig.depth) {
        result = await analyzePositionWithDepth(
          position.moves,
          analysisConfig.depth,
        );
      } else {
        // デフォルトは3秒解析
        result = await analyzePositionWithTime(position.moves, 3);
      }

      const resultEntry = {
        position: position.moves.join(" "),
        name: position.name,
        result,
      };

      results.push(resultEntry);

      if (onProgress) {
        onProgress(i + 1, positions.length, result);
      }

      console.log(
        `Analyzed ${i + 1}/${positions.length}: ${position.name || position.moves.join(" ")}`,
      );
    } catch (error) {
      console.error(`Failed to analyze position ${i + 1}:`, error);
    }
  }

  return results;
}

// ===== エラーハンドリング =====

/**
 * エンジンコマンドを安全に実行
 */
export async function safeEngineCommand<T>(
  command: () => Promise<T>,
  errorMessage: string = "Engine command failed",
): Promise<T | null> {
  try {
    return await command();
  } catch (error) {
    console.error(`${errorMessage}:`, error);
    return null;
  }
}

/**
 * エンジンの状態をチェック
 */
export async function checkEngineStatus(): Promise<{
  isInitialized: boolean;
  engineInfo: EngineInfo | null;
  currentSettings: EngineSettings | null;
  analysisStatus: AnalysisStatus[];
}> {
  const engineInfo = await safeEngineCommand(
    getEngineInfo,
    "Failed to get engine info",
  );
  const currentSettings = await safeEngineCommand(
    getEngineSettings,
    "Failed to get engine settings",
  );
  const analysisStatus =
    (await safeEngineCommand(
      getAnalysisStatus,
      "Failed to get analysis status",
    )) || [];

  return {
    isInitialized: engineInfo !== null,
    engineInfo,
    currentSettings,
    analysisStatus,
  };
}

// ===== エンジンセットアップのヘルパー関数 =====

/**
 * エンジンを完全にセットアップ（初期化 + 推奨設定適用）
 */
export async function setupYaneuraOuEngine(): Promise<EngineInfo | null> {
  try {
    // 1. エンジン初期化
    await initializeYaneuraOuEngine();
    console.log("Engine initialized");

    // 2. エンジン情報取得
    const engineInfo = await getEngineInfo();
    if (engineInfo) {
      console.log("Engine info:", engineInfo.name);
    }

    // 3. 推奨設定適用
    await applyYaneuraOuRecommendedSettings();
    console.log("Recommended settings applied");

    return engineInfo;
  } catch (error) {
    console.error("Failed to setup engine:", error);
    throw error;
  }
}

// ===== デフォルトエクスポート =====
export default {
  // 初期化・情報取得
  initializeEngine,
  initializeYaneuraOuEngine,
  getEngineInfo,
  setupYaneuraOuEngine,

  // 設定
  applyEngineSettings,
  getEngineSettings,
  applyYaneuraOuRecommendedSettings,
  applyCustomSettings,

  // 局面設定
  setPosition,
  setPositionFromMoves,
  setPositionFromSfen,

  // 解析
  startInfiniteAnalysis,
  analyzeWithTime,
  analyzeWithDepth,
  stopAnalysis,

  // 結果取得
  getAnalysisResult,
  getLastResult,
  getAnalysisStatus,

  // 高レベル操作
  startAnalysisFromMoves,
  startAnalysisFromSfen,
  analyzePositionWithTime,
  analyzePositionWithDepth,

  // ポーリング・リアルタイム
  pollAnalysisResult,
  startInfiniteAnalysisWithPolling,

  // バッチ処理
  batchAnalyze,

  // エンジン管理
  shutdownEngine,
  checkEngineStatus,

  // ユーティリティ
  formatEvaluation,
  formatPrincipalVariation,
  formatAnalysisConfig,
  createAnalysisSummary,
  createAnalysisStatusSummary,
  safeEngineCommand,

  // 定数
  ENGINE_CONSTANTS,
};
