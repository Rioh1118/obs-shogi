import { readKindedFailure } from "@/shared/lib/kindedFailure";
import type { SaveFailureKind } from "../api/rust-types";
import type { SaveFailure } from "../model/types";

/** Rust の種類の一覧（`readKindedFailure` に渡す。`satisfies Record` で union と揃える） */
const SAVE_FAILURE_KINDS = {
  conflict: true,
  readOnly: true,
  io: true,
  invalid: true,
} satisfies Record<SaveFailureKind, true>;

/** `savePresets` が投げた値を読む（`readKindedFailure`） */
export function asSaveFailure(error: unknown): SaveFailure {
  return readKindedFailure(error, SAVE_FAILURE_KINDS);
}
