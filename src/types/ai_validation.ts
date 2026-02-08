export type EngineIssueCode =
  | "NOT_CONFIGURED"
  | "MISSING_AI_ROOT"
  | "MISSING_ENGINES_DIR"
  | "MISSING_ENGINE"
  | "MISSING_PROFILE_DIR"
  | "MISSING_EVAL_DIR"
  | "MISSING_NN_BIN"
  | "MISSING_BOOK_DIR"
  | "MISSING_BOOK_DB"
  | "INVALID_WORK_DIR"
  | "MISSING_PATH"
  | "SCAN_ERROR"
  | "VALIDATION_ERROR";

export type EngineIssue = {
  code: EngineIssueCode;
  message: string;
  path?: string;
};

export type EngineValidation =
  | { status: "idle"; issues: EngineIssue[] }
  | { status: "checking"; issues: EngineIssue[] }
  | { status: "ok"; issues: [] }
  | { status: "ng"; issues: EngineIssue[] };
