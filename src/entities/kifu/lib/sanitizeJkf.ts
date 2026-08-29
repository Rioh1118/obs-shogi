import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";

/**
 * JKF の forks から空配列・null 先頭エントリを再帰的に除去する。
 *
 * JKFPlayer は getReadableForkKifu() で fork[0] に無条件アクセスするため、
 * 空フォーク [] が存在すると TypeError になる。
 *
 * 呼ぶのは `entities/kifu/api/parse` の出口だけ。`JKFData` を手にした側は
 * 空の変化が無いことを前提にしてよい。複数箇所で掛けると forkIndex が
 * どの時点の並びを指すのかが読めなくなる。
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

export function sanitizeJkf(kifu: JKFData): JKFData {
  return { ...kifu, moves: sanitizeJkfMoves(kifu.moves) };
}
