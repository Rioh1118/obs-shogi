export type AppErrorCode =
  | "tauri_invoke_failed"
  | "fs_error"
  | "engine_error"
  | "schema_mismatch"
  | "unknown";

export interface AppError {
  code: AppErrorCode;
  message: string;
  userMessage: string;
  cause?: unknown;
}

export function makeAppError(
  code: AppErrorCode,
  message: string,
  userMessage: string,
  cause?: unknown,
): AppError {
  return { code, message, userMessage, cause };
}

interface FsErrorShape {
  code: string;
  message: string;
  path?: string;
}

function isFsErrorShape(value: unknown): value is FsErrorShape {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

export function fromUnknown(
  e: unknown,
  fallbackUserMessage = "予期しないエラーが発生しました",
): AppError {
  if (isFsErrorShape(e)) {
    return {
      code: "fs_error",
      message: e.message,
      userMessage: e.message || fallbackUserMessage,
      cause: e,
    };
  }
  if (e instanceof Error) {
    return {
      code: "unknown",
      message: e.message,
      userMessage: fallbackUserMessage,
      cause: e,
    };
  }
  if (typeof e === "string") {
    return {
      code: "tauri_invoke_failed",
      message: e,
      userMessage: e || fallbackUserMessage,
      cause: e,
    };
  }
  return {
    code: "unknown",
    message: "non-error thrown",
    userMessage: fallbackUserMessage,
    cause: e,
  };
}
