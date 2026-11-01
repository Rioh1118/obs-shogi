import type { BookError, BookErrorCode } from "../model/types";

/**
 * 実行時に綴りを確かめるための一覧。
 *
 * `satisfies Record<BookErrorCode, true>` で union と結ぶ。配列で別に並べると、
 * 一覧から落ちた綴りが tsc を通り、その種別だけが黙って `unknown` に落ちる。
 *
 * Rust の `src-tauri/src/book/error.rs` の `book_error_codes!` との突き合わせは
 * `src/__tests__/bookErrorCodes.test.ts`。
 */
const BOOK_ERROR_CODES = {
  not_found: true,
  permission_denied: true,
  invalid_type: true,
  invalid_path: true,
  unknown_extension: true,
  unsupported_format: true,
  invalid_content: true,
  too_large: true,
  invalid_handle: true,
  invalid_sfen: true,
  io: true,
  unknown: true,
} satisfies Record<BookErrorCode, true>;

function isBookErrorCode(value: unknown): value is BookErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BOOK_ERROR_CODES, value);
}

/**
 * Tauri の reject 値を `BookError` にする。
 *
 * `String(error)` に潰さない。reject 値はプレーンオブジェクトなので `"[object Object]"` になり、
 * どのファイルで何が起きたかが画面から消える。
 *
 * `code` だけが知らない綴りなら、残りを拾って `unknown` にする。Rust に種別が増えた版でも、
 * 利用者に見せる文は届く。
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
