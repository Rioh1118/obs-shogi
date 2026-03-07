import type { FsError } from "@/entities/file-tree/api/error";
import type { FileConflictState } from "@/entities/file-tree/model/types";
import type { AsyncResult } from "@/shared/lib/result";

export type { FileConflictState };

export type ConflictKind = "file" | "directory";

export type ConflictCopy = {
  title: string;
  description: string;
  cancelLabel: string;
  renameLabel?: string;
  canRename: boolean;
};

export type FileConflictDialogProps = {
  conflict: FileConflictState | null;
  onCancel: () => void;
  onSubmitRename: (nextName: string) => AsyncResult<void, FsError>;
};
