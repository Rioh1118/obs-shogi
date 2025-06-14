export const ENGINE_CONSTANTS = {
  ENGINE_PATH:
    "/Users/riohatta/test_shogi_engine/li/YaneuraOu_NNUE_halfKP1024X2_8_32-V830Git_APPLEM1",
  WORK_DIR: "/Users/riohatta/test_shogi_engine/li",
  EVAL_DIR: "/Users/riohatta/test_shogi_engine/li/eval",
  BOOK_DIR: "/Users/riohatta/test_shogi_engine/li/book",
} as const;

export const DEFAULT_SETTINGS = {
  YANEURAOU_RECOMMENDED: {
    USI_Hash: "1024",
    Threads: "4",
    MultiPV: "5",
    NetworkDelay: "120",
    NetworkDelay2: "1120",
    MinimumThinkingTime: "2000",
    SlowMover: "100",
    BookFile: "user_book1.db",
    EvalDir: "eval",
  },
  POLLING_INTERVAL: 500,
  DEFAULT_ANALYSIS_TIME: 3,
} as const;

export const EVENT_NAMES = {
  ANALYSIS_UPDATE: "analysis-update",
  ANALYSIS_COMPLETE: "analysis-complete",
  ENGINE_ERROR: "engine-error",
} as const;
