import type { FileConflictRequest } from "@/entities/file-tree";

/**
 * その衝突が**モーダルの中から**起きたか。
 *
 * 解決したあと発端のモーダルを閉じるかどうかがここで決まる。閉じないと、
 * ファイルは作られたのに入力がそのまま残ったフォームが下から出てきて、
 * 成功が誰にも伝わらない。
 *
 * 網羅の `switch` にしてある。`||` の連鎖にすると、変種が増えたとき
 * 黙って「モーダルではない」に落ちて上の症状が戻る
 */
export function isRaisedFromModal(request: FileConflictRequest): boolean {
  switch (request.kind) {
    case "create_file":
    case "import_file":
      return true;

    // ツリーから起こすので、閉じる相手がいない
    case "create_directory":
    case "rename_file":
    case "rename_directory":
    case "move_file":
    case "move_directory":
      return false;
  }
}
