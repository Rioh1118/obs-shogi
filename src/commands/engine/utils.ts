import type {
  AnalysisConfig,
  AnalysisStatus,
  EngineStatus,
  Evaluation,
} from "@/entities/engine/api/rust-types";
import {
  getAnalysisStatus,
  getEngineInfo,
  getEngineSettings,
} from "@/entities/engine/api/tauri";

// ===== フォーマット関数 =====
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

// ===== エラーハンドリング =====
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

export async function checkEngineStatus(): Promise<EngineStatus> {
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

// ===== バリデーション =====
export function validateMoves(moves: string[]): boolean {
  if (!Array.isArray(moves)) return false;
  return moves.every((move) => typeof move === "string" && move.length > 0);
}

export function validateSfen(sfen: string): boolean {
  if (typeof sfen !== "string") return false;
  // 基本的なSFEN形式チェック（簡易版）
  const parts = sfen.split(" ");
  return parts.length >= 4; // 盤面 手番 持ち駒 移動数 最低限
}

export function validateAnalysisConfig(
  config: AnalysisConfig,
): config is AnalysisConfig {
  if (typeof config !== "object" || config === null) return false;

  // 必須プロパティのチェック
  if (typeof config.mate_search !== "boolean") return false;

  // オプショナルプロパティのチェック
  if (
    config.time_limit &&
    (typeof config.time_limit.secs !== "number" ||
      typeof config.time_limit.nanos !== "number")
  )
    return false;

  if (config.depth_limit && typeof config.depth_limit !== "number")
    return false;
  if (config.node_limit && typeof config.node_limit !== "number") return false;
  if (config.multi_pv && typeof config.multi_pv !== "number") return false;

  return true;
}
