import { JKFPlayer } from "json-kifu-format";
import type { JKFData } from "../model/jkf";
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

/**
 * JKF とカーソルから再生済みの player を作る
 *
 * `jkf` は複製されない。`JKFPlayer` が棋譜を書き換えるのは `inputMove` だけなので、
 * 読むだけの用途なら1つの JKF を複数の player で共有してよい。
 * `inputMove` を呼ぶなら複製を渡すこと。
 */
export function buildPlayer(jkf: JKFData, cursor: KifuCursor | null): JKFPlayer {
  const player = new JKFPlayer(jkf);
  applyCursorToPlayer(player, cursor);
  return player;
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
