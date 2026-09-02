import { useEffect, useRef } from "react";
import { List, type ListImperativeAPI } from "react-window";
import type { VirtualListBaseProps } from "./types";

export function VirtualList<RowProps extends object>({
  className,
  style,
  role,
  "aria-label": ariaLabel,
  rowCount,
  rowHeight,
  rowComponent,
  rowProps,
  overscanCount = 6,
  followIndex = null,
  followAlign = "smart",
  followBehavior = "instant",
}: VirtualListBaseProps<RowProps>) {
  const listRef = useRef<ListImperativeAPI | null>(null);

  useEffect(() => {
    if (followIndex == null) return;
    listRef.current?.scrollToRow({
      index: followIndex,
      align: followAlign,
      behavior: followBehavior,
    });
  }, [followIndex, followAlign, followBehavior]);

  return (
    <List<RowProps>
      className={className}
      // `List` は自前の role="list" より後ろで残りの props を展開するので、
      // ここで渡した role が勝つ
      role={role}
      aria-label={ariaLabel}
      style={{ height: "100%", ...style }}
      rowCount={rowCount}
      rowHeight={rowHeight}
      rowComponent={rowComponent}
      rowProps={rowProps}
      overscanCount={overscanCount}
      listRef={listRef}
    />
  );
}
