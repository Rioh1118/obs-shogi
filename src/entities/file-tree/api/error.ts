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
};
