import { Err, Ok, type Result } from "@/shared/lib/result";
import { makeFsError, type FsError } from "@/entities/file-tree/api/error";

/**
 * ファイル名・フォルダ名として使えるかを見て、**実際に使う形**を返す。
 *
 * Rust 側（`file_system/utils.rs` の `validate_basename`）と**同じ4つの規則**を
 * 同じ順で見る。手前に置くのは、通らないと分かっている名前を送って往復を
 * 待たせないため。最終的な可否は向こうが決めるので、**向こうより緩くしないこと。**
 * 片方だけ規則を増やすと、ここを通ってから向こうで落ちる名前ができる。
 *
 * `FsError` として返すので、Rust から返る失敗と同じ経路で表示できる。
 * `message` は開発者向けのログ。利用者に見せる文は `describeFsError` が code から作る。
 */
export function validateBasename(name: string): Result<string, FsError> {
  const next = name.trim();

  if (!next) {
    return Err(makeFsError("invalid_name_empty", "name is empty"));
  }

  if (next === "." || next === "..") {
    return Err(makeFsError("invalid_name_reserved", "name is a reserved path segment"));
  }

  if (/[/\\]/.test(next)) {
    return Err(makeFsError("invalid_name_separator", "name contains a path separator"));
  }

  // NUL は OS によっては別のパスに化ける
  if (next.includes("\0")) {
    return Err(makeFsError("invalid_name_control", "name contains a NUL byte"));
  }

  return Ok(next);
}
