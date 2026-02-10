// ===== 型定義のエクスポート =====
export type {
  EngineInfo,
  EngineOption,
  EngineOptionType,
  EngineSettings,
  AnalysisConfig,
  AnalysisResult,
  AnalysisStatus,
  AnalysisUpdateEvent,
  AnalysisCompleteEvent,
  BatchAnalysisPosition,
  BatchAnalysisConfig,
  BatchAnalysisResult,
  EngineStatus,
} from "./types";

// ===== 定数のエクスポート =====
export { DEFAULT_OPTIONS, EVENT_NAMES } from "./constants";

// ===== 基本コマンドのエクスポート =====
export {
  // エンジン管理
  initializeEngine,
  shutdownEngine,
  getEngineInfo,

  // エンジン設定
  applyEngineSettings,
  getEngineSettings,
  applyCustomSettings,

  // 局面設定
  setPosition,
  setPositionFromMoves,
  setPositionFromSfen,

  // 解析実行
  startInfiniteAnalysis,
  analyzeWithTime,
  analyzeWithDepth,
  stopAnalysis,

  // 結果取得
  getAnalysisResult,
  getLastResult,
  getAnalysisStatus,
} from "./core";

// ===== イベントリスナーのエクスポート =====

export {
  listenToAnalysisUpdates,
  listenToAnalysisComplete,
  listenToEngineErrors,
  setupAnalysisEventListeners,
  type AnalysisEventListeners,
} from "./events";

// ===== ユーティリティのエクスポート =====
export {
  formatEvaluation,
  formatPrincipalVariation,
  formatAnalysisConfig,
  createAnalysisSummary,
  createAnalysisStatusSummary,
  safeEngineCommand,
  checkEngineStatus,
  validateMoves,
  validateSfen,
  validateAnalysisConfig,
} from "./utils";

// ===== 高レベル操作のエクスポート =====
export {
  startAnalysisFromMoves,
  startAnalysisFromSfen,
  analyzePositionWithTime,
  analyzePositionWithDepth,
  batchAnalyze,
  quickAnalysis,
  deepAnalysis,
} from "./advanced";

// ===== デフォルトエクスポート（後方互換性のため） =====
import * as core from "./core";
import * as utils from "./utils";
import * as advanced from "./advanced";
import * as events from "./events";
import { DEFAULT_OPTIONS } from "./constants";

export default {
  // 基本機能
  ...core,

  // 高レベル操作
  ...advanced,

  // ユーティリティ
  ...utils,

  // イベント関連
  ...events,

  // 定数
  DEFAULT_OPTIONS,
};
