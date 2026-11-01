import { Err, Ok, type Result } from "@/shared/lib/result";
import { makeFsError, type FsError } from "@/entities/file-tree/api/error";

/**
 * ファイル名とフォルダ名として使えるかを見て、実際に使う形（前後の空白を落とした名前）を返す。
 *
 * Rust の `validate_basename`（`fs/path.rs`）と同じ4つの code を同じ順で返す。手前に置くのは、
 * 通らない名前を送って往復を待たせないため。最終的な可否は Rust が決める。
 * 成分が1つかの判定（Windows の `C:x`）は写していないので、その名前はここを通って
 * Rust が `invalid_name_separator` で断る。**ここだけ規則を増やすと、Rust が通す名前を断る。**
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
