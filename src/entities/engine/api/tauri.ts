import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisResult,
  AnalysisConfig,
  AnalysisStatus,
  EngineInfo,
  EngineSettings,
} from "./rust-types";

// ===== エンジン初期化・管理 =====
export async function initializeEngine(
  enginePath: string,
  workDir: string,
): Promise<void> {
  return await invoke("initialize_engine", {
    enginePath,
    workingDir: workDir,
  });
}

export async function shutdownEngine(): Promise<void> {
  return await invoke("shutdown_engine");
}

export async function getEngineInfo(): Promise<EngineInfo | null> {
  return await invoke("get_engine_info");
}

// ===== エンジン設定 =====
export async function applyEngineSettings(
  settings: EngineSettings,
): Promise<void> {
  return await invoke("apply_engine_settings", { settings });
}

export async function getEngineSettings(): Promise<EngineSettings> {
  return await invoke("get_engine_settings");
}

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
export async function setPosition(position: string): Promise<void> {
  return await invoke("set_position", { position });
}

export async function setPositionFromMoves(moves: string[]): Promise<void> {
  const position =
    moves.length > 0 ? `startpos moves ${moves.join(" ")}` : "startpos";
  return await setPosition(position);
}

export async function setPositionFromSfen(sfen: string): Promise<void> {
  const position = `${sfen}`;
  return await setPosition(position);
}

// ===== 解析実行 =====
export async function startInfiniteAnalysis(): Promise<string> {
  return await invoke("start_infinite_analysis");
}

export async function startAnalysisWithConfig(
  config: AnalysisConfig,
): Promise<string> {
  return await invoke("start_analysis_with_config", { config });
}

export async function analyzeWithTime(
  timeSeconds: number,
): Promise<AnalysisResult> {
  return await invoke("analyze_with_time", { timeSeconds });
}

export async function analyzeWithDepth(depth: number): Promise<AnalysisResult> {
  return await invoke("analyze_with_depth", { depth });
}

export async function stopAnalysis(sessionId?: string): Promise<void> {
  return await invoke("stop_analysis", { sessionId });
}

// ===== 結果取得 =====
export async function getAnalysisResult(
  sessionId: string,
): Promise<AnalysisResult | null> {
  return await invoke("get_analysis_result", { sessionId });
}

export async function getLastResult(): Promise<AnalysisResult | null> {
  return await invoke("get_last_result");
}

export async function getAnalysisStatus(): Promise<AnalysisStatus[]> {
  return await invoke("get_analysis_status");
}
