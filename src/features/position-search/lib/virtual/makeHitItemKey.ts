import type { PositionHit } from "@/entities/search";
import { hitKey } from "@/features/position-search/lib/orderPositionHits";

export function makeHitItemKey(hit: PositionHit, index: number) {
  return `${hitKey(hit)}:${index}`;
}
