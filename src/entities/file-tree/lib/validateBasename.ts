import { Err, Ok, type Result } from "@/shared/lib/result";
import { makeFsError, type FsError } from "@/entities/file-tree/api/error";

/**
 * ファイル名・フォルダ名として使えるかを見る。
 *
 * Rust 側（`file_system/utils.rs`）が同じ検証を持っているので、ここを通っても
 * 最終的な可否はあちらが決める。手前に置くのは、区切り文字を含む名前を送って
 * 往復を待たせないため。**あちらの規則を緩める方向に変えないこと。**
 *
 * `FsError` として返すので、Rust から返る失敗と同じ経路で表示できる。
 * `message` は開発者向けのログ。利用者に見せる文は `describeFsError` が code から作る。
 */
export function validateBasename(name: string): Result<string, FsError> {
  const next = name.trim();

  if (!next) {
    return Err(makeFsError("invalid_name_empty", "name is empty"));
  }

  if (/[/\\]/.test(next)) {
    return Err(makeFsError("invalid_name_separator", "name contains a path separator"));
  }

  return Ok(next);
}
