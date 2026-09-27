/**
 * Rust が `{ kind, message }` で返す失敗を読む。**形を信じない**——`invoke` が投げる値は
 * Rust の型のほかに、IPC そのものの失敗（文字列・`Error`）と、フロントが知らない種類が来うる。
 * 知らない種類を既知の種類に読み替えると、その種類の案内（再試行など）が合わない失敗に出る。
 *
 * `kinds` は `satisfies Record<K, true>` で union と揃えた一覧を渡す（配列で別に並べると、
 * union に足して一覧に足し忘れた種類が、実行時は必ず `unknown` に落ちる）
 */
export function readKindedFailure<K extends string>(
  error: unknown,
  kinds: Record<K, true>,
): { kind: K | "unknown"; message: string } {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const { kind, message } = error as { kind: unknown; message?: unknown };
    const text = typeof message === "string" ? message : String(error);
    const known = typeof kind === "string" && Object.prototype.hasOwnProperty.call(kinds, kind);
    return { kind: known ? (kind as K) : "unknown", message: text };
  }
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}
