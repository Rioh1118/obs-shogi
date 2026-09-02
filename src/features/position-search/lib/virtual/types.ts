import type { CSSProperties } from "react";
import type { Align, ListProps } from "react-window";

export type VirtualListAlign = Align;

export type VirtualScrollBehavior = "auto" | "instant" | "smooth";

export type VirtualListBaseProps<RowProps extends object> = {
  className?: string;
  style?: CSSProperties;

  // 器そのものに当てる。仮想化ではスクロールする要素が行の持ち主なので、
  // listbox のような「子を数える」役割は包む側でなくここに置く必要がある
  role?: string;
  "aria-label"?: string;

  rowCount: number;
  rowHeight: ListProps<RowProps>["rowHeight"];
  rowComponent: ListProps<RowProps>["rowComponent"];
  rowProps: ListProps<RowProps>["rowProps"];

  overscanCount?: number;

  followIndex?: number | null;
  followAlign?: VirtualListAlign;
  followBehavior?: VirtualScrollBehavior;
};
