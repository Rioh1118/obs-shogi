import type { StartFailure, StartFailureKind } from "../api/rust-types";

/**
 * エンジンを起動できなかったこと。`kind` が画面の文言を決め、`message` はログにだけ出す
 * （エンジンの出力を含み、利用者の言葉ではない）。
 *
 * 対局中のエンジンの異常による終局（`GameOverReason` の `engineFailure`）とは別物。
 */
export type EngineStartFailure = {
  kind: EngineStartFailureKind;
  message: string;
};

/**
 * 起動の失敗の種類。画面の文言を種類ごとに書く表（`ENGINE_START_FAILURE_NOTICES`）の鍵。
 * `unknown` は Rust の `StartFailure` の形でない値（IPC そのものの失敗、知らない種類）
 */
export type EngineStartFailureKind = StartFailureKind | "unknown";

/**
 * Rust の種類の一覧。**`satisfies Record` で union と揃える**——配列で別に並べると、
 * union に足して一覧に足し忘れた種類が、実行時は必ず `unknown` に落ちる
 */
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

function isStartFailureKind(kind: unknown): kind is StartFailureKind {
  return (
    typeof kind === "string" && Object.prototype.hasOwnProperty.call(START_FAILURE_KINDS, kind)
  );
}

/** `invoke` が投げた値を読む。**形を信じない**——知らない種類は `unknown` に落とす */
export function asStartFailure(error: unknown): EngineStartFailure {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const { kind, message } = error as Partial<StartFailure> & { kind: unknown };
    const text = typeof message === "string" ? message : String(error);
    return { kind: isStartFailureKind(kind) ? kind : "unknown", message: text };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}
