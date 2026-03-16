export type FsErrorCode =
  | "already_exists"
  | "not_found"
  | "invalid_name"
  | "invalid_path"
  | "invalid_type"
  | "invalid_extension"
  | "invalid_destination"
  | "permission_denied"
  | "io"
  | "unknown";

export type FsError = {
  code: FsErrorCode;
  message: string;
  path?: string;
  existingPath?: string;
  cause?: string;
};

export function asFsError(error: unknown): FsError {
  return error as FsError;
}

export function makeFsError(
  code: FsErrorCode,
  message: string,
  path?: string,
): FsError {
  return { code, message, path };
}
