import type { JKFData, JKFMove } from "@/entities/kifu/model/jkf";

/**
 * 中身のある変化か
 *
 * `forks` の要素が空配列でも先頭が null でも、`fork[0]` を読む側は同じように壊れる。
 * 落とす側と弾く側で条件がずれないよう、判定はここ1つにする。
 */
export function isUsableFork(fork: JKFMove[]): boolean {
  return fork.length > 0 && fork[0] != null;
}

/**
 * `forks` から、空の変化と先頭が null の変化を再帰的に取り除く
 *
 * JKFPlayer は getReadableForkKifu() で `fork[0]` に無条件でアクセスするため、
 * 空の変化が1つでもあると TypeError になる。
 */
function sanitizeJkfMoves(moves: JKFMove[]): JKFMove[] {
  return moves.map((m) => {
    if (!m.forks) return m;
    const cleanForks = m.forks.filter(isUsableFork).map((fork) => sanitizeJkfMoves(fork));
    return { ...m, forks: cleanForks.length > 0 ? cleanForks : undefined };
  });
}

/**
 * 「空の変化を含まない」という `JKFData` の不変条件を満たす
 *
 * 呼ぶのは `entities/kifu/api/parse` の出口だけ。`JKFData` を受け取った側は
 * 空の変化が無いことを前提にしてよい。
 *
 * 空の変化を落とすと、後ろに並ぶ変化の `forkIndex` は1つずつ繰り上がる。
 * `ForkPointer` を作ったあとに掛けると、その値は別の変化を指す。
 * だから入口で1回だけ掛ける。
 */
export function sanitizeJkf(kifu: JKFData): JKFData {
  return { ...kifu, moves: sanitizeJkfMoves(kifu.moves) };
}
