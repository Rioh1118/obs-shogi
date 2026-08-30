import { cursorFromLite } from "@/entities/search";
import type { PositionHit } from "@/entities/search";
import { cursorKey } from "@/entities/kifu/model/cursor";

/**
 * ヒットの同一性。索引の位置（file / gen / node）とカーソルの組。
 *
 * カーソル側の直列化は `cursorFromLite` → `cursorKey` に任せる。ここで自前に
 * 組み直すと、鍵の書式が2つになる。
 */
export const hitKey = (h: PositionHit) =>
  `${h.occ.fileId}:${h.occ.gen}:${h.occ.nodeId}:${cursorKey(cursorFromLite(h.cursor))}`;

export function orderPositionHits(
  hits: PositionHit[],
  resolveAbsPath: (hit: PositionHit) => string | null,
  currentAbs: string | null,
) {
  if (!currentAbs) return hits;

  const same: PositionHit[] = [];
  const other: PositionHit[] = [];

  for (const hit of hits) {
    const abs = resolveAbsPath(hit);
    if (abs && abs === currentAbs) same.push(hit);
    else other.push(hit);
  }

  // stable：元の相対順序を保つ
  return [...same, ...other];
}
