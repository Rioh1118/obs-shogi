import type { ForkPointer } from "@/types";

/** 未来計画を更新（te に forkIndex を上書き） */
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

/** “本譜を選ぶ” = その te の forkPointer を削除 */
export function removeForkPointer(
  fps: ForkPointer[],
  te: number,
): ForkPointer[] {
  return fps.filter((p) => p.te !== te);
}

/** 任意：te の計画を取り出す */
export function getPlannedForkIndex(
  fps: ForkPointer[] | undefined,
  te: number,
): number | undefined {
  return fps?.find((p) => p.te === te)?.forkIndex;
}

/** 任意：Map化（leaf探索や goToEnd で使うなら便利） */
export function buildPlannedMap(
  fps: ForkPointer[] | undefined,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const p of fps ?? []) map.set(p.te, p.forkIndex);
  return map;
}
