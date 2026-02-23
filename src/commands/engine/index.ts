// ===== 定数のエクスポート =====
export { EVENT_NAMES } from "./constants";

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
  formatAnalysisConfig,
  safeEngineCommand,
  checkEngineStatus,
  validateMoves,
  validateSfen,
  validateAnalysisConfig,
} from "./utils";

// ===== デフォルトエクスポート（後方互換性のため） =====
import * as utils from "./utils";
import * as events from "./events";

export default {
  // ユーティリティ
  ...utils,

  // イベント関連
  ...events,
};
