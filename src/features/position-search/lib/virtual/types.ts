import type { PositionHit } from "@/entities/search";
import type { CSSProperties } from "react";
import type { Align, ListImperativeAPI, ListProps } from "react-window";

export type VirtualListAlign = Align;

export type VirtualListRef = React.RefObject<ListImperativeAPI | null>;

export type VirtualScrollBehavior = "auto" | "instant" | "smooth";

export type VirtualListBaseProps<RowProps extends object> = {
  className?: string;
  style?: CSSProperties;

  rowCount: number;
  rowHeight: ListProps<RowProps>["rowHeight"];
  rowComponent: ListProps<RowProps>["rowComponent"];
  rowProps: ListProps<RowProps>["rowProps"];

  overscanCount?: number;

  followIndex?: number | null;
  followAlign?: VirtualListAlign;
  followBehavior?: VirtualScrollBehavior;
};

export type RelPathCache = Map<string, string>;

export type HitListItemData = {
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
