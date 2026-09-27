import { readKindedFailure } from "@/shared/lib/kindedFailure";
import type { StartFailure, StartFailureKind } from "../api/rust-types";

/**
 * エンジンを起動できなかったこと。`kind` が画面の文言を決め、`message` はログにだけ出す
 * （エンジンの出力を含み、利用者の言葉ではない）。
 *
 * 対局中のエンジンの異常による終局（`GameOverReason` の `engineFailure`）とは別物。
 */
export type EngineStartFailure = Omit<StartFailure, "kind"> & {
  kind: EngineStartFailureKind;
};

/**
 * 起動の失敗の種類。画面の文言を種類ごとに書く表（`ENGINE_START_FAILURE_NOTICES`）の鍵。
 * `unknown` は Rust の `StartFailure` の形でない値（IPC そのものの失敗、知らない種類）
 */
export type EngineStartFailureKind = StartFailureKind | "unknown";

/** Rust の種類の一覧（`readKindedFailure` に渡す。`satisfies Record` で union と揃える） */
const START_FAILURE_KINDS = {
  spawnFailed: true,
  quarantined: true,
  notUsi: true,
  exitedEarly: true,
  timedOut: true,
  invalidValue: true,
  cancelled: true,
  other: true,
} satisfies Record<StartFailureKind, true>;

/** `invoke` が投げた値を読む（`readKindedFailure`） */
export function asStartFailure(error: unknown): EngineStartFailure {
  return readKindedFailure(error, START_FAILURE_KINDS);
}
