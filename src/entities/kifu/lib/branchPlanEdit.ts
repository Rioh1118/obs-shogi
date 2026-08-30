import type { ForkPointer } from "../model/cursor";

/**
 * te の選択を計画に書き込む（同じ te があれば上書き）
 *
 * 返りは te 昇順。並びが崩れると `buildTesuuPointer` が同じ計画を別のキーにする。
 */
export function upsertForkPointer(
  fps: ForkPointer[],
  te: number,
  forkIndex: number,
): ForkPointer[] {
  const map = new Map<number, ForkPointer>();
  for (const p of fps) map.set(p.te, p);
  map.set(te, { te, forkIndex });
  return [...map.values()].sort((a, b) => a.te - b.te);
}

/**
 * te 以降の計画を捨てる
 *
 * te の選択を変えたら、その先の計画は別の枝に対して作られた値なので意味を失う。
 * 残すと、利用者が一度も見ていない変化に盤が入る。
 */
export function truncatePlanFrom(fps: ForkPointer[], te: number): ForkPointer[] {
  return fps.filter((p) => p.te < te);
}
