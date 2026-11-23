import { useCallback, useEffect, type RefObject } from "react";
import { kifuRowId } from "../lib/rowId";

/**
 * 棋譜の一覧のフォーカス。持つのは一覧そのものと、いまの手の行のボタンだけ。
 *
 * ほかの行のボタンに残ると、輪がいまの手と別の行に出る。
 * どの関数も一覧を流さない。流すかは呼び手が決める。
 */
export function useListFocus(listRef: RefObject<HTMLElement | null>, currentTesuu: number) {
  const focusList = useCallback(() => {
    listRef.current?.focus({ preventScroll: true });
  }, [listRef]);

  /** ほかの行のボタンに来たフォーカスを、一覧へ戻す */
  const settleFocus = useCallback(() => {
    const list = listRef.current;
    const focused = document.activeElement;
    if (!list || !focused || focused === list || !list.contains(focused)) return;
    if (focused.closest(`#${kifuRowId(currentTesuu)}`)) return;

    focusList();
  }, [listRef, currentTesuu, focusList]);

  useEffect(settleFocus, [settleFocus]);

  /** 開いたボタンへフォーカスを返す。そのボタンが消えたか押せなくなっていれば、一覧へ */
  const returnFocus = useCallback(
    (opener: HTMLElement | null) => {
      opener?.focus({ preventScroll: true });
      if (!listRef.current?.contains(document.activeElement)) focusList();
    },
    [listRef, focusList],
  );

  return { focusList, settleFocus, returnFocus };
}
