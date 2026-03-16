import type { JKFData, JKFMove } from "@/entities/kifu";

function sanitizeMoves(moves: JKFMove[]): JKFMove[] {
  return moves.map((m) => {
    if (!m.forks) return m;
    const cleanForks = m.forks
      .filter((fork) => fork.length > 0 && fork[0] != null)
      .map((fork) => sanitizeMoves(fork));
    return { ...m, forks: cleanForks.length > 0 ? cleanForks : undefined };
  });
}

export function cloneJKF(kifu: JKFData): JKFData {
  const sc = globalThis.structuredClone as
    | ((x: JKFData) => JKFData)
    | undefined;
  const cloned =
    typeof sc === "function"
      ? sc(kifu)
      : (JSON.parse(JSON.stringify(kifu)) as JKFData);
  return { ...cloned, moves: sanitizeMoves(cloned.moves) };
}
