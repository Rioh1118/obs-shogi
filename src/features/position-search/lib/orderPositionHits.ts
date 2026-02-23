import type { PositionHit } from "@/entities/search";

export const hitKey = (h: PositionHit) =>
  `${h.occ.file_id}:${h.occ.gen}:${h.occ.node_id}:${h.cursor.tesuu}:${h.cursor.fork_pointers.join(",")}`;

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
