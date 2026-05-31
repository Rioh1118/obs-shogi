import type { PositionHit } from "@/entities/search";

export const hitKey = (h: PositionHit) =>
  `${h.occ.fileId}:${h.occ.gen}:${h.occ.nodeId}:${h.cursor.tesuu}:${h.cursor.forkPointers
    .map((p) => `${p.te}-${p.forkIndex}`)
    .join(",")}`;

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
