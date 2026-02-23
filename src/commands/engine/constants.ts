export const ANALYSIS_SETTING = {
  POLLING_INTERVAL: 500,
  DEFAULT_ANALYSIS_TIME: 3,
} as const;

export const EVENT_NAMES = {
  ANALYSIS_UPDATE: "analysis-update",
  ANALYSIS_COMPLETE: "analysis-complete",
  ENGINE_ERROR: "engine-error",
} as const;
