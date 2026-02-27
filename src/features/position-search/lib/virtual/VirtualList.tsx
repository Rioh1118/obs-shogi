import { useEffect, useRef } from "react";
import { List, type ListImperativeAPI } from "react-window";
import type { VirtualListBaseProps } from "./types";

export function VirtualList<RowProps extends object>({
  className,
  style,
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
