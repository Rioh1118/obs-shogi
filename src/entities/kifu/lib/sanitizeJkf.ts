import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";

/**
 * `forks` から、空の変化と先頭が null の変化を再帰的に取り除く
 *
 * JKFPlayer は getReadableForkKifu() で `fork[0]` に無条件でアクセスするため、
 * 空の変化が1つでもあると TypeError になる。
 */
export function sanitizeJkfMoves(moves: JKFMove[]): JKFMove[] {
  return moves.map((m) => {
    if (!m.forks) return m;
    const cleanForks = m.forks
      .filter((fork) => fork.length > 0 && fork[0] != null)
      .map((fork) => sanitizeJkfMoves(fork));
    return { ...m, forks: cleanForks.length > 0 ? cleanForks : undefined };
  });
}

/**
 * 「空の変化を含まない」という `JKFData` の不変条件を満たす
 *
 * 呼ぶのは `entities/kifu/api/parse` の出口だけ。`JKFData` を受け取った側は
 * 空の変化が無いことを前提にしてよい。複数箇所で掛けると `forkIndex` が
 * どの時点の並びを指すのかが読めなくなる。
 */
export function sanitizeJkf(kifu: JKFData): JKFData {
  return { ...kifu, moves: sanitizeJkfMoves(kifu.moves) };
}
