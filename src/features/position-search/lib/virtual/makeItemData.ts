import type { PositionHit } from "@/entities/search";
import type { HitListItemData, RelPathCache } from "./types";

type Args = {
  hits: PositionHit[];
  activeIndex: number;
  isSearching: boolean;

  rootDir: string | null;
  currentAbs: string | null;

  relCache: RelPathCache;

  resolveAbsPath: (hit: PositionHit) => string | null;
  onActiveIndexChange: (next: number) => void;
  onAccept: (hit: PositionHit) => void;

  acceptOnClick: boolean;
};

export function makeHitListItemData(args: Args): HitListItemData {
  return {
    hits: args.hits,
    activeIndex: args.activeIndex,
    isSearching: args.isSearching,
    rootDir: args.rootDir,
    currentAbs: args.currentAbs,
    relCache: args.relCache,
    resolveAbsPath: args.resolveAbsPath,
    onActiveIndexChange: args.onActiveIndexChange,
    onAccept: args.onAccept,
    acceptOnClick: args.acceptOnClick,
  };
}
