import type { BookError, BookErrorCode } from "../model/types";

const CODES: readonly BookErrorCode[] = [
  "not_found",
  "permission_denied",
  "invalid_type",
  "invalid_path",
  "unknown_extension",
  "unsupported_format",
  "invalid_content",
  "too_large",
  "invalid_handle",
  "invalid_sfen",
  "io",
  "unknown",
];

function isBookErrorCode(value: unknown): value is BookErrorCode {
  return typeof value === "string" && (CODES as readonly string[]).includes(value);
}

/**
 * Tauri の reject 値を [`BookError`] にする。
 *
 * **`String(error)` に潰さない。** Tauri の reject 値はプレーンオブジェクトなので、
 * まとめて文字列にすると `"[object Object]"` になり、**どのファイルで何が起きたかまで
 * 画面から消える。**
 *
 * code だけが知らない綴りなら、残りは拾い直して `unknown` にする ——
 * Rust 側が種別を1つ足して、こちらの一覧を更新する前に配られた版でも、
 * 利用者に見せる文と復帰操作は届く。
 */
export function asBookError(error: unknown): BookError {
  const raw = error as Partial<BookError> | null | undefined;

  if (raw && typeof raw === "object" && typeof raw.message === "string") {
    return {
      code: isBookErrorCode(raw.code) ? raw.code : "unknown",
      message: raw.message,
      path: typeof raw.path === "string" ? raw.path : null,
    };
  }

  return { code: "unknown", message: String(error), path: null };
}
