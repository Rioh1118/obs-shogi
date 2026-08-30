import type { PositionHit } from "@/entities/search";
import { cursorFromLite } from "@/entities/search/lib/cursorAdapter";
import { cursorKey } from "@/entities/kifu/model/cursor";

/**
 * ヒットの同一性。索引の位置（file / gen / node）とカーソルの組。
 *
 * カーソル側は `cursorKey` に寄せる。索引は `fork_pointers` の並びを保証しないので、
 * 自前で直列化すると同じヒットが並び順の違いだけで別の鍵になる。
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
