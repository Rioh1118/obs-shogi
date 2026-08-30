import type { FileConflictState } from "../model/types";
import type { ConflictKind } from "../model/types";

/**
 * 網羅の `switch` にしてある。`default` を置くと、`FileConflictRequest` に
 * 変種が増えたとき黙って `"file"` に落ちる。同じフォルダの他の3本と揃える
 */
export function getConflictKind(request: FileConflictState["request"]): ConflictKind {
  switch (request.kind) {
    case "create_directory":
    case "rename_directory":
    case "move_directory":
      return "directory";
    case "create_file":
    case "import_file":
    case "rename_file":
    case "move_file":
      return "file";
  }
}
