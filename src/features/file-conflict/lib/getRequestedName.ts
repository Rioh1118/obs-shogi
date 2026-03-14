import type { FileConflictState } from "../model/types";

function basename(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function getRequestedName(conflict: FileConflictState): string {
  const req = conflict.request;

  switch (req.kind) {
    case "create_file":
      return req.options.fileName;
    case "import_file":
      return req.fileName;
    case "create_directory":
      return req.dirName;
    case "rename_file":
    case "rename_directory":
      return req.newName;
    case "move_file":
    case "move_directory":
      return req.newName ?? basename(req.path);
  }
}
