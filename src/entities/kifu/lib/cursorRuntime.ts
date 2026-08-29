import { JKFPlayer } from "json-kifu-format";
import type { ForkPointer, KifuCursor } from "../model/cursor";

/** 読むのは forkPointers だけ。ダミーの tesuuPointer を作らせないよう引数を狭めてある。 */
export function appliedForkPointers(
  cursor: Pick<KifuCursor, "forkPointers"> | null,
  tesuu: number,
): ForkPointer[] {
  const map = new Map<number, ForkPointer>();
  for (const p of cursor?.forkPointers ?? []) {
    if (p.te <= tesuu) map.set(p.te, p);
  }
  return [...map.values()].sort((a, b) => a.te - b.te);
}

export function applyCursorToPlayer(jkf: JKFPlayer, cursor: KifuCursor | null) {
  if (!cursor) return;
  jkf.goto(cursor.tesuu, appliedForkPointers(cursor, cursor.tesuu));
}

export function mergeForkPointers(
  applied: ForkPointer[],
  prevAll: ForkPointer[] | undefined,
  tesuu: number,
): ForkPointer[] {
  const future = (prevAll ?? []).filter((p) => p.te > tesuu);

  const map = new Map<number, ForkPointer>();
  for (const p of future) map.set(p.te, p);
  for (const p of applied) map.set(p.te, p);

  return [...map.values()].sort((a, b) => a.te - b.te);
}
