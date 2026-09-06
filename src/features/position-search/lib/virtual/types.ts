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
  tabIndex?: number;

  rowCount: number;
  rowHeight: ListProps<RowProps>["rowHeight"];
  rowComponent: ListProps<RowProps>["rowComponent"];
  rowProps: ListProps<RowProps>["rowProps"];

  overscanCount?: number;

  followIndex?: number | null;
  followAlign?: VirtualListAlign;
  followBehavior?: VirtualScrollBehavior;
  /**
   * 添字が変わっていなくても追い直したいときの合図。**器の高さが変わる側が渡す。**
   *
   * 仮想リストは `scrollTop` を保つので、上に何かが差し込まれて器が縮むと
   * 選んでいる行が画面外へ押し出される。添字は動いていないので追従は再発火せず、
   * 「断りだけが見えていて、それが指している行は視界の外」になる
   */
  followNonce?: unknown;
};
