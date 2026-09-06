import { useCallback, useEffect, useRef } from "react";
import { List, type ListImperativeAPI } from "react-window";
import type { VirtualListBaseProps } from "./types";

export function VirtualList<RowProps extends object>({
  className,
  style,
  role,
  "aria-label": ariaLabel,
  tabIndex,
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

  const follow = useCallback(() => {
    if (followIndex == null) return;
    listRef.current?.scrollToRow({
      index: followIndex,
      align: followAlign,
      behavior: followBehavior,
    });
  }, [followIndex, followAlign, followBehavior]);

  useEffect(follow, [follow]);

  // **器が縮んだら追い直す。** 仮想リストは `scrollTop` を保つので、上に何かが
  // 差し込まれて器が縮むと選んでいる行が画面外へ押し出される。添字は動いていない
  // ので上の追従は再発火せず、「断りだけが見えていて、それが指している行は視界の
  // 外」になる。
  //
  // **合図を外から受け取らない。** 高さが変わったことを知っているのは器だけで、
  // 外から渡すと器を縮める要因を数え落とす（一覧が自分で出す注記など）。
  //
  // **広がったときは追わない。** 行は視界から出ないので、追うと利用者の
  // スクロールを理由なく引き戻す
  const onResize = useCallback(
    (size: { height: number }, prev: { height: number }) => {
      if (size.height >= prev.height) return;
      follow();
    },
    [follow],
  );

  return (
    <List<RowProps>
      className={className}
      // `List` は自前の role="list" より後ろで残りの props を展開するので、
      // ここで渡した role が勝つ
      role={role}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      style={{ height: "100%", ...style }}
      rowCount={rowCount}
      rowHeight={rowHeight}
      rowComponent={rowComponent}
      rowProps={rowProps}
      overscanCount={overscanCount}
      onResize={onResize}
      listRef={listRef}
    />
  );
}
