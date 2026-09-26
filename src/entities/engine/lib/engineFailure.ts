import type { StartFailure, StartFailureKind } from "../api/rust-types";

/**
 * 起動の失敗。`kind` が画面の文言を決め、`message` はログにだけ出す
 * （エンジンの出力を含み、利用者の言葉ではない）。
 *
 * `unknown` は Rust の `StartFailure` の形でない値（IPC そのものの失敗、知らない種類）。
 */
export type EngineFailure = {
  kind: EngineFailureKind;
  message: string;
};

/** 起動の失敗の種類。画面の文言を種類ごとに書く表（`ENGINE_FAILURE_NOTICES`）の鍵 */
export type EngineFailureKind = StartFailureKind | "unknown";

const KINDS: ReadonlySet<string> = new Set<StartFailureKind>([
  "spawnFailed",
  "quarantined",
  "notUsi",
  "exitedEarly",
  "timedOut",
  "invalidValue",
  "cancelled",
  "other",
]);

/** `invoke` が投げた値を読む。**形を信じない**——知らない種類は `unknown` に落とす */
export function asEngineFailure(error: unknown): EngineFailure {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const { kind, message } = error as Partial<StartFailure> & { kind: unknown };
    const text = typeof message === "string" ? message : String(error);
    if (typeof kind === "string" && KINDS.has(kind)) {
      return { kind: kind as StartFailureKind, message: text };
    }
    return { kind: "unknown", message: text };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}
