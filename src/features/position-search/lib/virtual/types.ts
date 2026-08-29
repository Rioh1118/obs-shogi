import type { CSSProperties } from "react";
import type { Align, ListProps } from "react-window";

export type VirtualListAlign = Align;

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
