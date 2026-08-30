import type { FileConflictState } from "../model/types";

/**
 * 対話1回分を表す鍵。**どの操作を解決しようとしているか**だけで決まり、
 * 打ち直した名前では変わらない。
 *
 * 別名で送ってもう一度衝突すると、provider は新しい `conflict` オブジェクトを作る。
 * オブジェクトの同一性で入力を初期化すると、そのたびに入力が要求名へ戻り、
 * 直前に置いた失敗の理由も一緒に消える。**押せず、理由も出ない状態で止まる。**
 */
export function getConflictSessionKey(conflict: FileConflictState): string {
  const req = conflict.request;

  switch (req.kind) {
    case "create_file":
    case "import_file":
    case "create_directory":
      return `${req.kind}:${req.parentPath}`;
    case "rename_file":
    case "rename_directory":
      return `${req.kind}:${req.path}`;
    case "move_file":
    case "move_directory":
      return `${req.kind}:${req.path}:${req.destDir}`;
  }
}
