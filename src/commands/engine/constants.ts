export const DEFAULT_OPTIONS: Record<string, string> = {
  USI_Hash: "1024",
  Threads: "4",
  MultiPV: "5",
  NetworkDelay: "120",
  NetworkDelay2: "1120",
  MinimumThinkingTime: "2000",
  SlowMover: "100",
};

export const ANALYSIS_SETTING = {
  POLLING_INTERVAL: 500,
  DEFAULT_ANALYSIS_TIME: 3,
} as const;

export const EVENT_NAMES = {
  ANALYSIS_UPDATE: "analysis-update",
  ANALYSIS_COMPLETE: "analysis-complete",
  ENGINE_ERROR: "engine-error",
} as const;
