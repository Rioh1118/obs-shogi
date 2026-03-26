import type { FileConflictState } from "../model/types";
import type { ConflictKind } from "../model/types";

export function getConflictKind(request: FileConflictState["request"]): ConflictKind {
  switch (request.kind) {
    case "create_directory":
    case "rename_directory":
    case "move_directory":
      return "directory";
    default:
      return "file";
  }
}
