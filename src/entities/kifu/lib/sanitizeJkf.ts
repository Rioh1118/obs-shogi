import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";

/**
 * JKF の forks から空配列・null 先頭エントリを再帰的に除去する。
 *
 * JKFPlayer は getReadableForkKifu() で fork[0] に無条件アクセスするため、
 * 空フォーク [] が存在すると TypeError になる。
 *
 * ゲーム本体と viewer が同じ sanitize 済みデータを参照するよう、
 * データの入り口（parseKifuContentToJKF 直後）で一度だけ適用すること。
 * これにより forkIndex の整合性が保たれる。
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
