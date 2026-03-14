import type { FileConflictState } from "../model/types";
import { getConflictKind } from "../lib/getConflictKind";
import { getRequestedName } from "../lib/getRequestedName";

import "./FileConflictDialog.scss";

function dirname(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const idx = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  return idx >= 0 ? normalized.slice(0, idx) : "";
}

function getActionLabel(conflict: FileConflictState): string {
  switch (conflict.request.kind) {
    case "create_file":
      return "新規作成";
    case "import_file":
      return "インポート";
    case "create_directory":
      return "フォルダ作成";
    case "rename_file":
    case "rename_directory":
      return "名前変更";
    case "move_file":
    case "move_directory":
      return "移動";
  }
}

function getDestinationLabel(conflict: FileConflictState): string | null {
  const req = conflict.request;
  switch (req.kind) {
    case "create_file":
    case "import_file":
    case "create_directory":
      return req.parentPath;
    case "move_file":
    case "move_directory":
      return req.destDir;
    case "rename_file":
    case "rename_directory":
      return dirname(req.path);
    default:
      return null;
  }
}

function getSourceLabel(conflict: FileConflictState): string | null {
  const req = conflict.request;
  switch (req.kind) {
    case "rename_file":
    case "rename_directory":
    case "move_file":
    case "move_directory":
      return req.path;
    default:
      return null;
  }
}

function ConflictMeta({ conflict }: { conflict: FileConflictState }) {
  const kind = getConflictKind(conflict.request);
  const requestedName = getRequestedName(conflict);
  const source = getSourceLabel(conflict);
  const destination = getDestinationLabel(conflict);
  const existing = conflict.error.existingPath ?? conflict.error.path ?? null;

  return (
    <div className="file-conflict__meta">
      <div className="file-conflict__meta-grid">
        <div className="file-conflict__field">
          <div className="file-conflict__label">操作</div>
          <div className="file-conflict__value">{getActionLabel(conflict)}</div>
        </div>

        <div className="file-conflict__field">
          <div className="file-conflict__label">種別</div>
          <div className="file-conflict__value">
            {kind === "file" ? "ファイル" : "フォルダ"}
          </div>
        </div>

        <div className="file-conflict__field file-conflict__field--full">
          <div className="file-conflict__label">入力した名前</div>
          <div className="file-conflict__pill">{requestedName}</div>
        </div>

        {source && (
          <div className="file-conflict__field file-conflict__field--full">
            <div className="file-conflict__label">元の項目</div>
            <div className="file-conflict__path">{source}</div>
          </div>
        )}

        {destination && (
          <div className="file-conflict__field file-conflict__field--full">
            <div className="file-conflict__label">保存先 / 移動先</div>
            <div className="file-conflict__path">{destination}</div>
          </div>
        )}

        {existing && (
          <div className="file-conflict__field file-conflict__field--full">
            <div className="file-conflict__label">既に存在する項目</div>
            <div className="file-conflict__path file-conflict__path--conflict">
              {existing}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConflictMeta;
