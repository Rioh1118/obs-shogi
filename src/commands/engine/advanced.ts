import type {
  AnalysisResult,
  BatchAnalysisPosition,
  BatchAnalysisConfig,
  BatchAnalysisResult,
  EngineInfo,
} from "./types";
import { DEFAULT_SETTINGS } from "./constants";
import {
  setPositionFromMoves,
  setPositionFromSfen,
  startInfiniteAnalysis,
  analyzeWithTime,
  analyzeWithDepth,
  initializeYaneuraOuEngine,
  getEngineInfo,
  applyYaneuraOuRecommendedSettings,
} from "./core";
import { validateMoves } from "./utils";

// ===== 高レベル操作関数 =====
export async function startAnalysisFromMoves(moves: string[]): Promise<string> {
  if (!validateMoves(moves)) {
    throw new Error("Invalid moves array");
  }
  await setPositionFromMoves(moves);
  return await startInfiniteAnalysis();
}

export async function startAnalysisFromSfen(sfen: string): Promise<string> {
  await setPositionFromSfen(sfen);
  return await startInfiniteAnalysis();
}

export async function analyzePositionWithTime(
  moves: string[],
  timeSeconds: number,
): Promise<AnalysisResult> {
  if (!validateMoves(moves)) {
    throw new Error("Invalid moves array");
  }
  if (timeSeconds <= 0) {
    throw new Error("Time must be positive");
  }

  await setPositionFromMoves(moves);
  return await analyzeWithTime(timeSeconds);
}

export async function analyzePositionWithDepth(
  moves: string[],
  depth: number,
): Promise<AnalysisResult> {
  if (!validateMoves(moves)) {
    throw new Error("Invalid moves array");
  }
  if (depth <= 0) {
    throw new Error("Depth must be positive");
  }

  await setPositionFromMoves(moves);
  return await analyzeWithDepth(depth);
}

// ===== バッチ解析機能 =====
export async function batchAnalyze(
  positions: BatchAnalysisPosition[],
  analysisConfig: BatchAnalysisConfig = {},
  onProgress?: (current: number, total: number, result: AnalysisResult) => void,
): Promise<BatchAnalysisResult[]> {
  const results: BatchAnalysisResult[] = [];

  for (let i = 0; i < positions.length; i++) {
    const position = positions[i];

    try {
      if (!validateMoves(position.moves)) {
        console.error(`Invalid moves for position ${i + 1}:`, position.moves);
        continue;
      }

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
        result = await analyzePositionWithTime(
          position.moves,
          DEFAULT_SETTINGS.DEFAULT_ANALYSIS_TIME,
        );
      }

      const resultEntry: BatchAnalysisResult = {
        position: position.moves.join(" "),
        name: position.name,
        result,
      };

      results.push(resultEntry);

      if (onProgress) {
        onProgress(i + 1, positions.length, result);
      }

      console.log(
        `Analyzed ${i + 1}/${positions.length}: ${
          position.name || position.moves.join(" ")
        }`,
      );
    } catch (error) {
      console.error(`Failed to analyze position ${i + 1}:`, error);
    }
  }

  return results;
}

// ===== エンジンセットアップ =====
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

// ===== 便利な解析メソッド =====
export async function quickAnalysis(
  moves: string[],
  seconds: number = 5,
): Promise<AnalysisResult> {
  return await analyzePositionWithTime(moves, seconds);
}

export async function deepAnalysis(
  moves: string[],
  depth: number = 20,
): Promise<AnalysisResult> {
  return await analyzePositionWithDepth(moves, depth);
}
